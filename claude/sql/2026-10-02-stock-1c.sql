-- ============================================================================
-- Sun-ice · 2026-10-02 · Залишки з 1С (серверна частина)
-- ============================================================================
-- ЩО РОБИТЬ
--   Приймає зріз залишків із 1С (Edge Function stock-sync викликає stock_apply_snapshot),
--   зберігає його і віддає лише адмінам через get_stock() — з фільтром складів за регіоном.
--   План і рішення власника: claude/stock-1c/00-ПЛАН-І-СТАТУС.md
--
-- ПРИНЦИПИ
--   • Файли не зберігаються: stock_levels — по рядку на пару «позиція × склад», кожен новий
--     валідний зріз ЗАМІНЮЄ попередній повністю (full sync; відсутня позиція = 0).
--   • Підозрілий зріз НЕ застосовується (порожній, застарілий, з майбутнього, надто малий,
--     забагато помилкових рядків) — старі залишки лишаються, причина йде в stock_sync_log.
--   • Однаковий хеш зрізу → лише оновлюємо «підтверджено о» (last_success_at), дані не чіпаємо.
--   • Усі таблиці закриті (RLS без політик + revoke). Клієнт читає ТІЛЬКИ через get_stock():
--     роль regional_admin/super_admin і status='approved'; регіональний адмін бачить склади
--     свого регіону + «центральні» (Київ), супер-адмін — усі. Чужі склади у відповідь не потрапляють.
--   • Запис — лише service_role (Edge Function). Нові функції закриті від anon (див.
--     2026-09-21-revoke-anon-rpc.sql). public.current_role()/current_region() — з префіксом схеми.
--
-- ВИКОНУВАТИ: Supabase → SQL Editor (або міграція). Повторний запуск безпечний (if not exists /
-- create or replace / on conflict). Залежності: таблиця public.regions, розширення pg_cron.
-- ============================================================================

-- ---------- Налаштування (один рядок; міняти без деплою) ----------
create table if not exists public.stock_settings (
  id                  int primary key default 1 check (id = 1),
  fresh_minutes       int     not null default 45,    -- до цього віку зріз «свіжий» (інтервал відправки 1С — 30 хв)
  stale_minutes       int     not null default 120,   -- після цього «може бути неактуальним» (~4 пропущені цикли)
  low_threshold       int     not null default 2,     -- вільних ≤ порогу → «мало»
  min_ratio           numeric not null default 0.5,   -- новий зріз < 50 % попереднього → відхилити
  max_error_ratio     numeric not null default 0.05,  -- >5 % некоректних рядків → відхилити
  max_future_minutes  int     not null default 10     -- generated_at з майбутнього більш ніж на стільки → відхилити
);
insert into public.stock_settings (id) values (1) on conflict (id) do nothing;

-- ---------- Склади: яка назва в 1С → який склад/регіон у застосунку ----------
create table if not exists public.stock_warehouses (
  code         text primary key,
  name_1c      text not null unique,            -- рівно як у звіті 1С (порівнюємо без урахування регістру й зайвих пробілів)
  name         text not null,                   -- як показувати в застосунку
  region_id    int  not null references public.regions(id),
  is_central   boolean not null default false,  -- true = склад Києва: його бачать адміни всіх регіонів
  show_in_app  boolean not null default true,
  sort_order   int  not null default 100
);

insert into public.stock_warehouses (code, name_1c, name, region_id, is_central, sort_order) values
  ('KYIV_GORENICHI',   'Основной Киев (Гореничи) С-А', 'Київ — Гореничі',   1, true, 10),
  ('KYIV_ZOLOTONOSHA', 'Дополнительный Золотоноша',    'Київ — Золотоноша', 1, true, 11),
  ('KYIV_MALYN',       'Дополнительный Малин',         'Київ — Малин',      1, true, 12),
  ('ODESA',            'Основной Одесса',              'Одеса',             2, false, 20),
  ('KHARKIV',          'Основной Харьков',             'Харків',            3, false, 30),
  ('LVIV',             'Основной Львов',               'Львів',             4, false, 40),
  ('ZAPORIZHZHIA',     'Основной Запорожье',           'Запоріжжя',         5, false, 50),
  ('DNIPRO',           'Основной Днепр',               'Дніпро',            6, false, 60)
on conflict (code) do nothing;

-- ---------- Залишки (поточний зріз) ----------
create table if not exists public.stock_levels (
  item_key        text not null,                -- нормалізована назва (верхній регістр, без пробілів, кирилічні двійники → латиниця)
  warehouse_code  text not null references public.stock_warehouses(code) on delete cascade,
  item_name       text not null,                -- назва «як у 1С»
  physical        numeric not null check (physical >= 0),                        -- «Залишок» (всього на складі)
  available       numeric not null check (available >= 0 and available <= physical), -- «Вільний залишок»
  primary key (item_key, warehouse_code)
);

-- ---------- Стан останньої успішної синхронізації (один рядок) ----------
create table if not exists public.stock_state (
  id                  int primary key default 1 check (id = 1),
  last_success_at     timestamptz,   -- коли востаннє отримали валідний зріз (навіть без змін) — від нього «свіжість»
  last_generated_at   timestamptz,   -- момент, на який правдиві застосовані залишки (з файлу 1С)
  last_hash           text,
  last_accepted_rows  int not null default 0
);
insert into public.stock_state (id) values (1) on conflict (id) do nothing;

-- ---------- Журнал синхронізацій ----------
create table if not exists public.stock_sync_log (
  id             bigserial primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null check (status in ('ok','unchanged','rejected','error')),
  reason         text,                       -- чому відхилено/помилка
  source         text not null default '1c', -- '1c' | 'manual' | 'dry_run'
  http_status    int,
  generated_at   timestamptz,
  received_rows  int,                        -- розібрано рядків у файлі
  accepted_rows  int,                        -- потрапило в stock_levels
  ignored_rows   int,                        -- склади поза списком (Неліквід, офіси...)
  error_rows     int,                        -- некоректні рядки
  clamped_rows   int,                        -- виправлено від'ємні/вільний>всього
  merged_rows    int,                        -- об'єднано дублікати за нормалізованою назвою
  duration_ms    int,
  content_hash   text
);
create index if not exists stock_sync_log_started_idx on public.stock_sync_log (started_at desc);

-- ---------- Закрити таблиці від клієнтів ----------
alter table public.stock_settings   enable row level security;
alter table public.stock_warehouses enable row level security;
alter table public.stock_levels     enable row level security;
alter table public.stock_state      enable row level security;
alter table public.stock_sync_log   enable row level security;
revoke all on public.stock_settings, public.stock_warehouses, public.stock_levels,
              public.stock_state, public.stock_sync_log from anon, authenticated;
revoke all on sequence public.stock_sync_log_id_seq from anon, authenticated;

-- ============================================================================
-- stock_apply_snapshot — єдине місце, де змінюються залишки. Викликає Edge Function (service_role).
--   p_rows: [{w: код складу, k: ключ, n: назва 1С, p: всього, a: вільно}, ...] — уже очищені в Edge Function
--   p_meta: {received, ignored, errors, clamped, merged, source, started_at, http_status}
-- Повертає jsonb {status, reason, accepted}. Відхилення — це НЕ помилка SQL (інакше відкотиться і запис у журнал).
-- ============================================================================
create or replace function public.stock_apply_snapshot(
  p_rows jsonb, p_generated_at timestamptz, p_hash text, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st      public.stock_state%rowtype;
  cfg     public.stock_settings%rowtype;
  v_count int := coalesce(jsonb_array_length(p_rows), 0);
  v_errs  int := coalesce((p_meta->>'errors')::int, 0);
  v_start timestamptz := coalesce((p_meta->>'started_at')::timestamptz, clock_timestamp());
  v_status text;
  v_reason text;
begin
  select * into st  from public.stock_state    where id = 1 for update;
  select * into cfg from public.stock_settings where id = 1;

  -- ---- перевірки: перша, що спрацювала, відхиляє зріз ----
  if p_generated_at is null then
    v_status := 'rejected'; v_reason := 'no_timestamp';
  elsif v_count = 0 then
    v_status := 'rejected'; v_reason := 'empty';
  elsif p_generated_at > now() + make_interval(mins => cfg.max_future_minutes) then
    v_status := 'rejected'; v_reason := 'timestamp_in_future';
  elsif st.last_generated_at is not null and p_generated_at < st.last_generated_at then
    v_status := 'rejected'; v_reason := 'older_than_applied';
  elsif (v_count + v_errs) > 0 and v_errs::numeric / (v_count + v_errs) > cfg.max_error_ratio then
    v_status := 'rejected'; v_reason := 'too_many_bad_rows';
  elsif st.last_accepted_rows > 0 and v_count < st.last_accepted_rows * cfg.min_ratio then
    v_status := 'rejected'; v_reason := 'snapshot_too_small';
  elsif st.last_hash is not distinct from p_hash then
    v_status := 'unchanged';
  else
    v_status := 'ok';
  end if;

  if v_status = 'ok' then
    delete from public.stock_levels where true;     -- повний зріз: відсутня позиція = 0
    insert into public.stock_levels (item_key, warehouse_code, item_name, physical, available)
    select x.k, x.w, x.n, greatest(x.p, 0), least(greatest(x.a, 0), greatest(x.p, 0))
    from jsonb_to_recordset(p_rows) as x(w text, k text, n text, p numeric, a numeric);
    update public.stock_state
       set last_success_at = now(), last_generated_at = p_generated_at,
           last_hash = p_hash, last_accepted_rows = v_count
     where id = 1;
  elsif v_status = 'unchanged' then
    update public.stock_state
       set last_success_at = now(), last_generated_at = greatest(coalesce(last_generated_at, p_generated_at), p_generated_at)
     where id = 1;
  end if;

  insert into public.stock_sync_log
    (started_at, finished_at, status, reason, source, http_status, generated_at,
     received_rows, accepted_rows, ignored_rows, error_rows, clamped_rows, merged_rows, duration_ms, content_hash)
  values
    (v_start, clock_timestamp(), v_status, v_reason, coalesce(p_meta->>'source', '1c'),
     nullif(p_meta->>'http_status', '')::int, p_generated_at,
     nullif(p_meta->>'received', '')::int, case when v_status in ('ok','unchanged') then v_count end,
     nullif(p_meta->>'ignored', '')::int, v_errs,
     nullif(p_meta->>'clamped', '')::int, nullif(p_meta->>'merged', '')::int,
     (extract(epoch from (clock_timestamp() - v_start)) * 1000)::int, p_hash);

  return jsonb_build_object('status', v_status, 'reason', v_reason, 'accepted', case when v_status in ('ok','unchanged') then v_count else 0 end);
end $$;

revoke all on function public.stock_apply_snapshot(jsonb, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.stock_apply_snapshot(jsonb, timestamptz, text, jsonb) to service_role;

-- ============================================================================
-- stock_log_failure — запис у журнал, коли файл навіть не вдалось розібрати (виклик із Edge Function)
-- ============================================================================
create or replace function public.stock_log_failure(p_reason text, p_http_status int, p_source text default '1c', p_duration_ms int default null)
returns void language sql security definer set search_path = public as $$
  insert into public.stock_sync_log (status, reason, http_status, source, finished_at, duration_ms)
  values ('error', left(p_reason, 500), p_http_status, coalesce(p_source, '1c'), now(), p_duration_ms);
$$;
revoke all on function public.stock_log_failure(text, int, text, int) from public, anon, authenticated;
grant execute on function public.stock_log_failure(text, int, text, int) to service_role;

-- ============================================================================
-- get_stock() — те, що бачить застосунок. null = доступу немає (не адмін / не підтверджений / гість).
-- ============================================================================
create or replace function public.get_stock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
  v_region int;
  st       public.stock_state%rowtype;
  cfg      public.stock_settings%rowtype;
  v_wh     jsonb;
  v_rows   jsonb;
begin
  if v_uid is null then return null; end if;
  select role, status, region_id into v_role, v_status, v_region from public.profiles where id = v_uid;
  if v_status is distinct from 'approved' or v_role not in ('regional_admin', 'super_admin') then return null; end if;

  select * into st  from public.stock_state    where id = 1;
  select * into cfg from public.stock_settings where id = 1;

  -- склади, які цей користувач має право бачити: супер-адмін — усі; регіональний — свого регіону + центральні (Київ)
  select coalesce(jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name, 'region_id', w.region_id, 'central', w.is_central) order by w.sort_order), '[]'::jsonb)
    into v_wh
    from public.stock_warehouses w
   where w.show_in_app
     and (v_role = 'super_admin' or w.region_id = v_region or w.is_central);

  select coalesce(jsonb_agg(jsonb_build_object('k', l.item_key, 'n', l.item_name, 'w', l.warehouse_code, 'p', l.physical, 'a', l.available)), '[]'::jsonb)
    into v_rows
    from public.stock_levels l
    join public.stock_warehouses w on w.code = l.warehouse_code
   where w.show_in_app
     and (v_role = 'super_admin' or w.region_id = v_region or w.is_central);

  return jsonb_build_object(
    'last_success_at',   st.last_success_at,
    'last_generated_at', st.last_generated_at,
    'server_now',        now(),
    'fresh_minutes',     cfg.fresh_minutes,
    'stale_minutes',     cfg.stale_minutes,
    'low_threshold',     cfg.low_threshold,
    'warehouses',        v_wh,
    'rows',              v_rows);
end $$;

revoke all on function public.get_stock() from public, anon;
grant execute on function public.get_stock() to authenticated;

-- ============================================================================
-- get_stock_sync_log() — для картки «Синхронізація залишків» (лише супер-адмін)
-- ============================================================================
create or replace function public.get_stock_sync_log(p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ok boolean;
begin
  select (role = 'super_admin' and status = 'approved') into v_ok from public.profiles where id = auth.uid();
  if v_ok is not true then return null; end if;
  return jsonb_build_object(
    'state',    (select to_jsonb(s) from public.stock_state s where id = 1),
    'settings', (select to_jsonb(c) from public.stock_settings c where id = 1),
    'log',      coalesce((select jsonb_agg(to_jsonb(g) order by g.started_at desc)
                            from (select * from public.stock_sync_log order by started_at desc limit least(greatest(p_limit, 1), 200)) g), '[]'::jsonb));
end $$;
revoke all on function public.get_stock_sync_log(int) from public, anon;
grant execute on function public.get_stock_sync_log(int) to authenticated;

-- ============================================================================
-- Чистка журналу: успіхи — 30 днів, відхилення/помилки — 180 днів (щодня о 03:30)
-- ============================================================================
select cron.schedule(
  'sunice-stock-log-cleanup', '30 3 * * *',
  $$ delete from public.stock_sync_log
      where (status in ('ok','unchanged') and started_at < now() - interval '30 days')
         or started_at < now() - interval '180 days' $$
);
