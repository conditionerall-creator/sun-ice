-- =====================================================================
-- 2026-10-18 — СТЕНД: базова схема для роботи над публікацією прайсу
-- =====================================================================
-- ⚠️ Застосовується ТІЛЬКИ до тестового проєкту `sun-ice-stend`
--    (ref: mhngmnxugguqfoxtwjej). До БОЕВОГО проєкту НЕ застосовувати —
--    там усе це вже є, і повторне виконання його зламає.
--
-- Навіщо: щоб перевіряти правила доступу до цін на акаунтах зі статусами,
-- яких у боевій базі немає взагалі (там усі 34 профілі — `approved`).
--
-- Що переноситься: лише те, від чого залежить доступ до цін —
--   regions, profiles, price_meta, price_issues + current_role()/current_region()
--   + тригер, що не дає користувачеві підвищити собі права.
-- Що НЕ переноситься: акції, залишки 1С, монтажі, push, філії, коди помилок —
--   до прайсу стосунку не мають.
--
-- Свідомі відмінності від боевої схеми:
--   * прибрані profiles.promo_ack_id / promo_last_nag_at / promo_balloon_last_at
--     (тягнули б за собою таблицю promotions);
--   * боєві дані не копіюються. Виняток — довідник regions: це назви міст,
--     не персональні дані, а без них не перевірити регіональні правила.
-- =====================================================================

-- ---------- Регіони ----------
create table if not exists public.regions (
  id         serial primary key,
  name       text    not null unique,
  sort_order integer not null default 0
);

insert into public.regions (id, name, sort_order) values
  (1, 'Київ', 1), (2, 'Одеса', 2), (3, 'Харків', 3),
  (4, 'Львів', 4), (5, 'Запоріжжя', 5), (6, 'Дніпро', 6)
on conflict (id) do nothing;

select setval(pg_get_serial_sequence('public.regions', 'id'),
              (select max(id) from public.regions));

alter table public.regions enable row level security;

drop policy if exists "public read regions" on public.regions;
create policy "public read regions" on public.regions
  for select using (true);

-- ---------- Профілі ----------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  phone           text,
  region_id       integer references public.regions(id),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'blocked')),
  price_type      text not null default 'regular'
                    check (price_type in ('regular', 'client', 'vip')),
  role            text not null default 'user'
                    check (role in ('user', 'regional_admin', 'super_admin')),
  created_at      timestamptz not null default now(),
  reregistered_at timestamptz
);

alter table public.profiles enable row level security;

-- ---------- Роль і регіон поточного користувача ----------
-- ПАСТКА: ім'я current_role збігається із зарезервованим словом Postgres,
-- тому в політиках ЗАВЖДИ писати public.current_role() з префіксом схеми.
create or replace function public."current_role"()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_region()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select region_id from public.profiles where id = auth.uid();
$$;

-- ---------- Політики профілів ----------
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

-- Реєстрація: лише свій рядок, лише звичайним користувачем і лише «на розгляді».
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert with check (
    auth.uid() = id and role = 'user' and status = 'pending' and price_type = 'regular'
  );

drop policy if exists "Regional admin can view region profiles" on public.profiles;
create policy "Regional admin can view region profiles" on public.profiles
  for select using (
    public."current_role"() = 'regional_admin' and region_id = public.current_region()
  );

drop policy if exists "Regional admin can update region profiles" on public.profiles;
create policy "Regional admin can update region profiles" on public.profiles
  for update using (
    public."current_role"() = 'regional_admin' and region_id = public.current_region()
  ) with check (
    public."current_role"() = 'regional_admin' and region_id = public.current_region()
  );

drop policy if exists "Super admin can view all profiles" on public.profiles;
create policy "Super admin can view all profiles" on public.profiles
  for select using (public."current_role"() = 'super_admin');

drop policy if exists "Super admin can update all profiles" on public.profiles;
create policy "Super admin can update all profiles" on public.profiles
  for update using (public."current_role"() = 'super_admin')
             with check (public."current_role"() = 'super_admin');

-- ---------- Ніхто, крім super_admin, не міняє роль і регіон ----------
-- RLS обмежує РЯДКИ, не КОЛОНКИ: без цього тригера регіональний адмін міг би
-- підняти собі роль, бо його ж рядок йому оновлювати дозволено.
create or replace function public.prevent_role_region_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.role is distinct from old.role or new.region_id is distinct from old.region_id) then
    if public."current_role"() <> 'super_admin' then
      raise exception 'Only super_admin can change role or region_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_region_change on public.profiles;
create trigger trg_prevent_role_region_change
  before update on public.profiles
  for each row execute function public.prevent_role_region_change();

-- ---------- Версія прайсу ----------
-- ⚠️ Як і в боевій базі: політика ЛИШЕ на читання. Записати версію з браузера
-- неможливо навіть super_admin'у — публікація піде через SECURITY DEFINER RPC.
create table if not exists public.price_meta (
  id         integer primary key default 1 check (id = 1),
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.price_meta (id, version) values (1, 1)
on conflict (id) do nothing;

alter table public.price_meta enable row level security;

drop policy if exists "public read price_meta" on public.price_meta;
create policy "public read price_meta" on public.price_meta
  for select using (true);

-- ---------- Журнал проблем розбору прайсу ----------
create table if not exists public.price_issues (
  id         bigint generated by default as identity primary key,
  version    text not null,
  tile_label text not null,
  brand      text not null,
  kind       text not null default 'error',
  message    text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version, tile_label, brand, kind)
);

alter table public.price_issues enable row level security;

drop policy if exists "price_issues select super_admin" on public.price_issues;
create policy "price_issues select super_admin" on public.price_issues
  for select to authenticated using (public."current_role"() = 'super_admin');

drop policy if exists "price_issues update super_admin" on public.price_issues;
create policy "price_issues update super_admin" on public.price_issues
  for update to authenticated using (public."current_role"() = 'super_admin')
                           with check (public."current_role"() = 'super_admin');
