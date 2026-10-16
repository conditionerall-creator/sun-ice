-- Залишки: наявність для ЗВИЧАЙНИХ користувачів (рішення власника 2026-10-16).
-- Застосовано в Supabase 2026-10-16 (міграції get_stock_for_approved_users_by_region
-- + get_stock_access_matches_price_access). Цей файл = те, що реально лежить у базі.
--
-- Було: get_stock() віддавала дані лише regional_admin / super_admin.
-- Стало: дилер теж отримує дані, але ТІЛЬКИ по основних складах свого регіону
--        (profiles.region_id — той, що він вказує при реєстрації).
--
-- ДОСТУП = ДОСТУП ДО ЦІН. Дослівно те саме правило, що profileAllowsPrices() у
-- js/07-access-info.js: відмова лише для статусів 'blocked'/'rejected' і для 'pending'
-- ПІСЛЯ повторної реєстрації. Свіжозареєстрований ('pending') ціни бачить — отже й
-- наявність бачить. Якщо колись зміните правило цін — міняйте обидва місця разом.
--
-- ЧОМУ ОБМЕЖЕННЯ НА СЕРВЕРІ, А НЕ В БРАУЗЕРІ: інакше будь-хто відкриє консоль і витягне
-- залишки всіх складів. Клієнт не повинен отримувати те, чого не має права бачити.
--
-- ЩО САМЕ ОТРИМУЄ ДИЛЕР:
--   rows      — точні кількості ТІЛЬКИ по складах свого регіону (Київ = Гореничі+Золотоноша+Малин);
--   elsewhere — перелік маркувань, яких у його регіоні немає, але вони вільні на інших
--               основних складах. БЕЗ кількостей і БЕЗ назв складів — рівно стільки, щоб
--               намалювати жовтий «0» із підказкою «є на інших складах», і ні байтом більше.
--
-- Адміни й супер-адміни отримують усе, як і раніше (mode='admin').
-- Профіль без region_id → null (позначок не буде; таких зараз немає, це страховка).

create or replace function public.get_stock()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_status  text;
  v_rereg   timestamptz;
  v_region  int;
  v_admin   boolean;
  v_allowed boolean;
  st        public.stock_state%rowtype;
  cfg       public.stock_settings%rowtype;
  v_wh      jsonb;
  v_rows    jsonb;
  v_else    jsonb;
begin
  if v_uid is null then return null; end if;

  select role, status, reregistered_at, region_id
    into v_role, v_status, v_rereg, v_region
    from public.profiles where id = v_uid;

  -- Те саме правило, що profileAllowsPrices() у js/07-access-info.js.
  v_allowed := v_status is not null
               and v_status not in ('blocked', 'rejected')
               and not (v_status = 'pending' and v_rereg is not null);
  if not v_allowed then return null; end if;

  -- Адмінські права — лише підтвердженим адмінам.
  v_admin := v_role in ('regional_admin', 'super_admin') and v_status = 'approved';

  if not v_admin and v_region is null then return null; end if;

  select * into st  from public.stock_state    where id = 1;
  select * into cfg from public.stock_settings where id = 1;

  if v_admin then
    -- ---------- АДМІН: усе, як було ----------
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', w.code, 'name', w.name, 'kind', w.kind,
             'region_id', w.region_id, 'region', r.name) order by w.sort_order), '[]'::jsonb)
      into v_wh
      from public.stock_warehouses w join public.regions r on r.id = w.region_id
     where w.show_in_app;

    select coalesce(jsonb_agg(jsonb_build_object(
             'k', l.item_key, 'n', l.item_name, 'w', l.warehouse_code,
             'p', l.physical, 'a', l.available)), '[]'::jsonb)
      into v_rows
      from public.stock_levels l join public.stock_warehouses w on w.code = l.warehouse_code
     where w.show_in_app;

    -- Адмін бачить усі склади, тож перелік «деінде» рахує сам клієнт (stock.js, elsewhereSet).
    v_else := '[]'::jsonb;
  else
    -- ---------- ДИЛЕР: лише основні склади свого регіону ----------
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', w.code, 'name', w.name, 'kind', w.kind,
             'region_id', w.region_id, 'region', r.name) order by w.sort_order), '[]'::jsonb)
      into v_wh
      from public.stock_warehouses w join public.regions r on r.id = w.region_id
     where w.show_in_app and w.kind = 'main' and w.region_id = v_region;

    select coalesce(jsonb_agg(jsonb_build_object(
             'k', l.item_key, 'n', l.item_name, 'w', l.warehouse_code,
             'p', l.physical, 'a', l.available)), '[]'::jsonb)
      into v_rows
      from public.stock_levels l join public.stock_warehouses w on w.code = l.warehouse_code
     where w.show_in_app and w.kind = 'main' and w.region_id = v_region;

    -- Маркування, яких немає у своєму регіоні, але вони Є на інших основних складах.
    -- За ЗАГАЛЬНИМ залишком, не за вільним (зауваження власника 2026-10-16): якщо в Києві
    -- 4 штуки й усі зарезервовані — товар фізично Є, і «немає ніде» було б неправдою.
    select coalesce(jsonb_agg(distinct l.item_key), '[]'::jsonb)
      into v_else
      from public.stock_levels l join public.stock_warehouses w on w.code = l.warehouse_code
     where w.show_in_app and w.kind = 'main' and w.region_id is distinct from v_region
       and l.physical > 0
       and not exists (
             select 1
               from public.stock_levels l2 join public.stock_warehouses w2 on w2.code = l2.warehouse_code
              where l2.item_key = l.item_key and w2.kind = 'main'
                and w2.region_id = v_region and l2.physical > 0);
  end if;

  return jsonb_build_object(
    'mode',              case when v_admin then 'admin' else 'user' end,
    'region_id',         v_region,
    'last_success_at',   st.last_success_at,
    'last_generated_at', st.last_generated_at,
    'server_now',        now(),
    'fresh_minutes',     cfg.fresh_minutes,
    'stale_minutes',     cfg.stale_minutes,
    'low_threshold',     cfg.low_threshold,
    'badge_threshold',   5,          -- межа «<5 / >5» (рішення власника 2026-10-16)
    'warehouses',        v_wh,
    'rows',              v_rows,
    'elsewhere',         v_else);
end $function$;

-- Відкат (повернути доступ лише адмінам): взяти попередню версію функції з бекап-тега
-- backup-2026-10-16-pre-stock-for-users або додати на початку умову
--   if v_role not in ('regional_admin','super_admin') then return null; end if;
