-- ============================================================================
-- CRМонтаж, Крок 5 (фінальний): зв'язування з напарником — Supabase SQL
-- ============================================================================
-- Розділ 4 ТЗ: інсталятор може запросити/підтвердити зв'язок з іншим підтвердженим
-- інсталятором (напарником). Після взаємного підтвердження обидва бачать монтажі,
-- позначені "спільний", можуть повністю редагувати їх і статус синхронно, і можуть
-- у будь-який момент розірвати зв'язок. Пошук напарника — за номером телефону, через
-- нову SQL-функцію (SECURITY DEFINER) — звичайний профіль іншого користувача через
-- RLS не видно, а функція повертає лише {id, full_name} ОДНОГО підтвердженого
-- інсталятора за точним номером, нікому іншому нічого не показуючи. Усе адитивне —
-- не змінює і не видаляє наявні RLS-політики profiles/installer_tasks. Виконати
-- одним запуском у Supabase SQL Editor.

-- ----------------------------------------------------------------------------
-- 1. Таблиця запитів/зв'язків напарників
-- ----------------------------------------------------------------------------
create table public.installer_partner_links (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint installer_partner_links_no_self check (requester_id <> partner_id)
);

-- Захист від дублю запиту/зв'язку між тією самою парою в будь-якому напрямку, поки
-- він pending або вже accepted (не заважає новому запиту після відхилення/розриву —
-- той рядок вже видалений). Не гарантує "лише один напарник" глобально — свідомо
-- лишається на розсуд користувачів, повноцінна БД-гарантія через тригер тут
-- непропорційна для невеликого внутрішнього інструменту.
alter table public.installer_partner_links
  add column pair_key text generated always as (
    least(requester_id::text, partner_id::text) || '_' || greatest(requester_id::text, partner_id::text)
  ) stored;

create unique index installer_partner_links_active_pair_uidx
  on public.installer_partner_links (pair_key)
  where status in ('pending', 'accepted');

alter table public.installer_partner_links enable row level security;

create policy "installer_partner_links_select" on public.installer_partner_links
  for select to authenticated using (auth.uid() in (requester_id, partner_id));

create policy "installer_partner_links_insert" on public.installer_partner_links
  for insert to authenticated with check (requester_id = auth.uid());

-- Підтвердити запит може лише той, кого запросили (partner_id), і лише переводом
-- у 'accepted'.
create policy "installer_partner_links_update" on public.installer_partner_links
  for update to authenticated
  using (partner_id = auth.uid())
  with check (status = 'accepted');

-- RLS using/with check не обмежує КОЛОНКИ, лише рядки — явно звужуємо привілей на
-- рівні Postgres, щоб напарник фізично не міг переписати requester_id/created_at
-- разом зі status у тому самому UPDATE.
revoke update on public.installer_partner_links from authenticated;
grant update (status, responded_at) on public.installer_partner_links to authenticated;

-- Скасувати власний pending-запит, відхилити вхідний, або розірвати вже прийнятий
-- зв'язок — усі три дії одним DELETE (обидві сторони завжди можуть видалити рядок,
-- де вони requester_id або partner_id).
create policy "installer_partner_links_delete" on public.installer_partner_links
  for delete to authenticated using (auth.uid() in (requester_id, partner_id));

-- ----------------------------------------------------------------------------
-- 2. Видимість профілю напарника (тільки ПІБ, тільки для сторін одного запиту/
--    зв'язку — pending ТА accepted, щоб можна було показати ім'я і в запрошенні,
--    і після підтвердження) — усі наявні select-політики profiles обмежені
--    власним рядком (auth.uid() = id), без цього імені взагалі ніде не показати.
-- ----------------------------------------------------------------------------
create policy "profiles_select_partner_link" on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.installer_partner_links l
      where l.status in ('pending', 'accepted')
        and ((l.requester_id = auth.uid() and l.partner_id = profiles.id)
          or (l.partner_id = auth.uid() and l.requester_id = profiles.id))
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Пошук напарника за номером телефону (SECURITY DEFINER, вузький результат)
-- ----------------------------------------------------------------------------
-- Порівнює лише цифри номера (regexp_replace) — не залежить від того, чи телефон
-- у profiles.phone збережений як "+380..." / "380..." / інакше. Повертає щонайбільше
-- один рядок {id, full_name} і лише якщо знайдений — підтверджений інсталятор, не
-- сам викликач; викликати може лише підтверджений інсталятор (перевірка всередині).
create or replace function public.find_installer_by_phone(p_phone text)
returns table(id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.role = 'installer' and me.status = 'approved'
  ) then
    raise exception 'unauthorized';
  end if;

  return query
  select p.id, p.full_name
  from public.profiles p
  where p.role = 'installer'
    and p.status = 'approved'
    and p.id <> auth.uid()
    and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')
  limit 1;
end;
$$;

revoke all on function public.find_installer_by_phone(text) from public;
grant execute on function public.find_installer_by_phone(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. installer_tasks: спільна видимість + повне редагування напарником
-- ----------------------------------------------------------------------------
alter table public.installer_tasks
  add column partner_visible boolean not null default false,
  add column assigned_to uuid references public.profiles(id);

-- Адитивні (OR-комбіновані з наявними own-політиками) SELECT і UPDATE: монтаж,
-- позначений "спільний" (partner_visible=true), видимий і повністю редагований
-- підтвердженим напарником власника — так само, як власнику. DELETE лишається
-- виключно власнику (додаткової delete-політики немає) — видалення суворіше за
-- редагування, і ТЗ явно про це не просив.
create policy "installer_tasks_partner_select" on public.installer_tasks
  for select to authenticated using (
    partner_visible = true
    and exists (
      select 1 from public.installer_partner_links l
      where l.status = 'accepted'
        and ((l.requester_id = installer_tasks.installer_id and l.partner_id = auth.uid())
          or (l.partner_id = installer_tasks.installer_id and l.requester_id = auth.uid()))
    )
  );

create policy "installer_tasks_partner_update" on public.installer_tasks
  for update to authenticated
  using (
    partner_visible = true
    and exists (
      select 1 from public.installer_partner_links l
      where l.status = 'accepted'
        and ((l.requester_id = installer_tasks.installer_id and l.partner_id = auth.uid())
          or (l.partner_id = installer_tasks.installer_id and l.requester_id = auth.uid()))
    )
  )
  with check (
    partner_visible = true
    and exists (
      select 1 from public.installer_partner_links l
      where l.status = 'accepted'
        and ((l.requester_id = installer_tasks.installer_id and l.partner_id = auth.uid())
          or (l.partner_id = installer_tasks.installer_id and l.requester_id = auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- ВІДКАТ (за потреби — прибирає все з цього файлу, у зворотному порядку)
-- ----------------------------------------------------------------------------
-- drop policy if exists "installer_tasks_partner_update" on public.installer_tasks;
-- drop policy if exists "installer_tasks_partner_select" on public.installer_tasks;
-- alter table public.installer_tasks drop column if exists assigned_to;
-- alter table public.installer_tasks drop column if exists partner_visible;
-- revoke all on function public.find_installer_by_phone(text) from authenticated;
-- drop function if exists public.find_installer_by_phone(text);
-- drop policy if exists "profiles_select_partner_link" on public.profiles;
-- drop table if exists public.installer_partner_links;
