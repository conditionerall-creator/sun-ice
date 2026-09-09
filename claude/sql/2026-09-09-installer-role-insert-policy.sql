-- ============================================================================
-- CRМонтаж, Крок 1: роль "installer" — Supabase SQL
-- ============================================================================
-- Виконувати в Supabase Dashboard → SQL Editor, у ДВА окремих запуски (спершу
-- діагностика, потім, якщо все чисто, сама політика).

-- ----------------------------------------------------------------------------
-- КРОК A. ДІАГНОСТИКА (виконати першою, окремо, і надіслати мені результат)
-- ----------------------------------------------------------------------------
-- Перевіряємо, чи немає на колонці profiles.role обмеження (CHECK-constraint або
-- enum-тип), яке не пропустить значення 'installer' незалежно від RLS-політики.

-- (a) Чи є CHECK-обмеження на profiles, і яке саме:
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'c';

-- (b) Чи role — звичайний текст, чи власний enum-тип:
select data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';

-- Якщо (a) показує щось на кшталт "role = ANY (ARRAY['user'::text, 'regional_admin'...]))"
-- без 'installer' у списку — знадобиться ALTER TABLE ... DROP CONSTRAINT + додати нову
-- з 'installer' у переліку. Якщо (b) показує НЕ text/varchar у udt_name — це enum-тип,
-- знадобиться ALTER TYPE <тип> ADD VALUE 'installer';
-- В обох випадках — просто надішліть мені результат цих двох запитів, я підготую точний
-- ALTER під те, що реально є.

-- ----------------------------------------------------------------------------
-- КРОК B. САМА ПОЛІТИКА (виконати після Кроку A, якщо діагностика чиста)
-- ----------------------------------------------------------------------------
-- Адитивна RLS-політика: нічого не видаляє й не замінює — існуюча self-insert
-- політика для role='user' лишається недоторканою. Postgres OR-комбінує кілька
-- permissive-політик для однієї команди (INSERT), тож обидві діють одночасно,
-- кожна ловить свій рядок за власною умовою WITH CHECK.

create policy "profiles_insert_self_installer"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and role = 'installer'
  and status = 'pending'
  and price_type = 'regular'
);

-- ----------------------------------------------------------------------------
-- ВІДКАТ (за потреби — прибирає тільки цю політику, більше нічого не чіпає)
-- ----------------------------------------------------------------------------
-- drop policy if exists "profiles_insert_self_installer" on public.profiles;

-- ============================================================================
-- КРОК C. CHECK-ОБМЕЖЕННЯ (виконати після Кроку B — підтверджено живим тестом
-- 2026-09-09, що воно є і саме воно блокує 'installer')
-- ============================================================================
-- Діагностика (Крок A) підтвердила: на profiles.role є CHECK-обмеження
-- "profiles_role_check", яке дозволяє лише 'user'/'regional_admin'/'super_admin'.
-- RLS-політика з Кроку B сама по собі нічого не вирішує, поки цей constraint не
-- пропускає 'installer' — рядок відхиляється ще до перевірки RLS.
-- Замінюємо на той самий constraint, просто з доданим 'installer' — існуючі рядки
-- не постраждають (усі вони й так задовольняють ширший список).

alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role = ANY (ARRAY['user'::text, 'regional_admin'::text, 'super_admin'::text, 'installer'::text]));

-- Відкат (повернути як було, БЕЗ 'installer'):
-- alter table public.profiles drop constraint profiles_role_check;
-- alter table public.profiles add constraint profiles_role_check
--   check (role = ANY (ARRAY['user'::text, 'regional_admin'::text, 'super_admin'::text]));
