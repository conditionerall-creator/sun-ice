-- ============================================================================
-- CRМонтаж, Крок 2: список монтажів — Supabase SQL
-- ============================================================================
-- Нова таблиця, персональна для кожного інсталятора. RLS обмежує кожного монтажника
-- лише власними рядками (installer_id = auth.uid()) — regional_admin/super_admin тут
-- нічого не бачать і не редагують, це особистий інструмент монтажника (розділ 3 ТЗ),
-- не частина адмінки. Виконати одним запуском у Supabase SQL Editor.

create table public.installer_tasks (
  id bigint generated always as identity primary key,
  installer_id uuid not null references public.profiles(id) on delete cascade,
  address text not null,
  scheduled_at timestamptz not null,
  client_name text,
  client_phone text,
  equipment_type text not null,
  is_heat_pump_tt boolean not null default false,
  comment text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.installer_tasks enable row level security;

create policy "installer_tasks_own_select" on public.installer_tasks
  for select to authenticated using (installer_id = auth.uid());

create policy "installer_tasks_own_insert" on public.installer_tasks
  for insert to authenticated with check (installer_id = auth.uid());

create policy "installer_tasks_own_update" on public.installer_tasks
  for update to authenticated using (installer_id = auth.uid()) with check (installer_id = auth.uid());

create policy "installer_tasks_own_delete" on public.installer_tasks
  for delete to authenticated using (installer_id = auth.uid());

-- ----------------------------------------------------------------------------
-- ВІДКАТ (за потреби — видаляє всю таблицю разом з даними монтажів!)
-- ----------------------------------------------------------------------------
-- drop table if exists public.installer_tasks;
