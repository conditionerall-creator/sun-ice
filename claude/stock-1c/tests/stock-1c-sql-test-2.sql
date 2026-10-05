-- Перевірка міграції 2026-10-05-stock-all-warehouses.sql (ТІЛЬКИ ЧИТАЄ і наприкінці навмисно падає з TESTRESULT — слідів не лишає).
-- Запуск після застосування claude/sql/2026-10-05-stock-all-warehouses.sql: вставити цей блок у SQL Editor / execute_sql.
-- Очікується: регіональний адмін бачить усі склади (17 = 8 основних + 9 додаткових), user і гість — null, anon не може get_stock.
-- (Старий тест stock-1c-sql-test.sql перевіряє регіональний фільтр із міграції 1 — після міграції 2 він застарів.)
do $t$
declare res text := ''; v jsonb; u uuid;
begin
  select id into u from public.profiles where role = 'regional_admin' and status = 'approved' limit 1;
  perform set_config('request.jwt.claim.sub', u::text, true);
  v := public.get_stock();
  res := res || E'\nрегіональний адмін: складів ' || jsonb_array_length(v->'warehouses') || ' (очікувано 17), основних '
         || (select count(*) from jsonb_array_elements(v->'warehouses') w where w->>'kind' = 'main') || ' (8), додаткових '
         || (select count(*) from jsonb_array_elements(v->'warehouses') w where w->>'kind' = 'additional') || ' (9)';
  select id into u from public.profiles where role = 'user' and status = 'approved' limit 1;
  perform set_config('request.jwt.claim.sub', u::text, true);
  res := res || E'\nзвичайний user: ' || coalesce(public.get_stock()::text, 'null') || ' (очікувано null)';
  perform set_config('request.jwt.claim.sub', '', true);
  res := res || E'\nгість: ' || coalesce(public.get_stock()::text, 'null') || ' (очікувано null)';
  res := res || E'\nanon execute: ' || has_function_privilege('anon', 'public.get_stock()', 'execute') || ' (false), authenticated: '
         || has_function_privilege('authenticated', 'public.get_stock()', 'execute') || ' (true)';
  res := res || E'\nДонецьк у списку складів: ' || exists (select 1 from public.stock_warehouses where name_1c ilike '%Донецк%') || ' (false — ігноруємо)';
  raise exception 'TESTRESULT %', res;
end $t$;
