-- ============================================================================
-- Sun-ice · 2026-10-05 · Залишки: додаткові склади + усі адміни бачать усі склади
-- ============================================================================
-- РІШЕННЯ ВЛАСНИКА (2026-10-05) — скасовує попереднє R-3 («регіональний адмін бачить свій регіон + Київ»):
--   • усі підтверджені regional_admin і super_admin бачать УСІ склади й УСІ залишки;
--   • звичайні користувачі й гості — нічого (get_stock() повертає null);
--   • склади діляться на «основні» (kind='main', 8 штук) і «додаткові» (kind='additional'); у короткій панелі
--     показуються лише основні, у вікні «Повна інформація» — всі;
--   • «Основной Донецк» ІГНОРУЄМО повністю — у цій таблиці його немає, рядки цього складу з файлу 1С відкидаються
--     (рахуються в ignored_rows журналу), як і «<Об'єкт не знайдено>».
-- Список складів — це ДАНІ (таблиця), а не код: додати/перейменувати склад = INSERT/UPDATE тут, без заливки застосунку.
-- Повторний запуск безпечний.
-- ============================================================================

alter table public.stock_warehouses
  add column if not exists kind text not null default 'main' check (kind in ('main', 'additional'));

update public.stock_warehouses set kind = 'main'
 where code in ('KYIV_GORENICHI','KYIV_ZOLOTONOSHA','KYIV_MALYN','ODESA','KHARKIV','LVIV','ZAPORIZHZHIA','DNIPRO');

-- region_id тут — лише підпис/фільтр у вікні «Повна інформація» (на видимість більше не впливає)
insert into public.stock_warehouses (code, name_1c, name, region_id, is_central, kind, sort_order) values
  ('KYIV_USED',         'Дополнительный б/у',              'Київ — б/у',              1, true,  'additional', 70),
  ('KYIV_POTIE',        'Дополнительный Киев (Потье) С-А', 'Київ — Потьє',            1, true,  'additional', 71),
  ('KYIV_OFFICE',       'САН-АЙС киевский офис',           'Київ — офіс',             1, true,  'additional', 72),
  ('KYIV_SERVICE',      'Сервисный Центр С-А',             'Київ — сервісний центр',  1, true,  'additional', 73),
  ('KYIV_TRAINING',     'Учебный Центр Киев С-А',          'Київ — навчальний центр', 1, true,  'additional', 74),
  ('ODESA_OFFICE',      'Склад офис Одесса',               'Одеса — офіс',            2, false, 'additional', 75),
  ('KHARKIV_NONLIQUID', 'Неліквід Харків',                 'Харків — неліквід',       3, false, 'additional', 76),
  ('LVIV_NONLIQUID',    'Неліквід Львів',                  'Львів — неліквід',        4, false, 'additional', 77),
  ('DNIPRO_NONLIQUID',  'Неліквід Дніпро',                 'Дніпро — неліквід',       6, false, 'additional', 78)
on conflict (code) do nothing;

-- get_stock(): усі склади (show_in_app) для будь-якого підтвердженого адміна; склад несе kind і назву регіону
create or replace function public.get_stock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
  st       public.stock_state%rowtype;
  cfg      public.stock_settings%rowtype;
  v_wh     jsonb;
  v_rows   jsonb;
begin
  if v_uid is null then return null; end if;
  select role, status into v_role, v_status from public.profiles where id = v_uid;
  if v_status is distinct from 'approved' or v_role not in ('regional_admin', 'super_admin') then return null; end if;

  select * into st  from public.stock_state    where id = 1;
  select * into cfg from public.stock_settings where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name, 'kind', w.kind, 'region_id', w.region_id, 'region', r.name) order by w.sort_order), '[]'::jsonb)
    into v_wh
    from public.stock_warehouses w join public.regions r on r.id = w.region_id
   where w.show_in_app;

  select coalesce(jsonb_agg(jsonb_build_object('k', l.item_key, 'n', l.item_name, 'w', l.warehouse_code, 'p', l.physical, 'a', l.available)), '[]'::jsonb)
    into v_rows
    from public.stock_levels l join public.stock_warehouses w on w.code = l.warehouse_code
   where w.show_in_app;

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
