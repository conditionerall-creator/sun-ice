-- ============================================================================
-- CRМонтаж: прибрати роль "installer" і фічу "напарник" — Supabase SQL
-- ============================================================================
-- Рішення користувача: розділ CRМонтаж більше не прив'язаний до окремої ролі —
-- доступний однаково будь-якому залогіненому користувачу (user/regional_admin/
-- super_admin), розмежування за роллю "installer" не мало сенсу для особистого
-- списку монтажів. Разом з роллю прибирається й фіча "напарник" (усе, що додано
-- 2026-09-10-installer-partner-links.sql) — вона існувала лише через
-- багатокористувацьку модель ролі "installer".
--
-- Користувач підтвердив: SQL із 2026-09-10-installer-partner-links.sql (Крок 5) уже
-- був виконаний у Supabase, тому цей файл повністю прибирає зроблене тим файлом, а
-- потім прибирає саму роль "installer" (зроблену 2026-09-09-installer-role-insert-
-- policy.sql, Крок 1). Таблиця public.installer_tasks і її "власні" RLS-політики
-- (Крок 2, installer_tasks_own_*) НЕ чіпаються — вони ніколи не залежали від ролі
-- (лише installer_id = auth.uid()), тому продовжують працювати для будь-якої ролі
-- без змін. Виконати одним запуском у Supabase SQL Editor.

-- ----------------------------------------------------------------------------
-- 1. Прибрати фічу "напарник" (усе з Кроку 5)
-- ----------------------------------------------------------------------------
drop policy if exists "installer_tasks_partner_update" on public.installer_tasks;
drop policy if exists "installer_tasks_partner_select" on public.installer_tasks;

alter table public.installer_tasks drop column if exists assigned_to;
alter table public.installer_tasks drop column if exists partner_visible;

revoke all on function public.find_installer_by_phone(text) from authenticated;
drop function if exists public.find_installer_by_phone(text);

drop policy if exists "profiles_select_partner_link" on public.profiles;

drop table if exists public.installer_partner_links;

-- ----------------------------------------------------------------------------
-- 2. Прибрати роль "installer" (усе з Кроку 1)
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_insert_self_installer" on public.profiles;

-- Захисний UPDATE перед звуженням CHECK-обмеження: якщо десь лишився рядок з
-- role='installer' (наприклад, видалення користувача не зачепило б profiles), він
-- інакше заблокував би ADD CONSTRAINT нижче помилкою валідації. Якщо таких рядків
-- немає (як і очікується — користувач уже видалив усіх інсталяторів) — цей UPDATE
-- просто нічого не змінює.
update public.profiles set role = 'user' where role = 'installer';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = ANY (ARRAY['user'::text, 'regional_admin'::text, 'super_admin'::text]));

-- ----------------------------------------------------------------------------
-- ВІДКАТ (за потреби — повертає роль "installer" і фічу "напарник"; для напарника
-- це лише схема, дані запитів/зв'язків, звісно, вже втрачені після DROP TABLE вище)
-- ----------------------------------------------------------------------------
-- alter table public.profiles drop constraint profiles_role_check;
-- alter table public.profiles add constraint profiles_role_check
--   check (role = ANY (ARRAY['user'::text, 'regional_admin'::text, 'super_admin'::text, 'installer'::text]));
-- create policy "profiles_insert_self_installer" on public.profiles
--   for insert to authenticated with check (
--     auth.uid() = id and role = 'installer' and status = 'pending' and price_type = 'regular'
--   );
-- (далі — повторити повний вміст 2026-09-10-installer-partner-links.sql)
