-- Тест SQL-частини залишків. НЕ ЗАЛИШАЄ слідів: виконується одним пакетом ПІСЛЯ міграції
-- (claude/sql/2026-10-02-stock-1c.sql) і наприкінці навмисно падає з помилкою TESTRESULT —
-- PostgreSQL відкочує весь пакет, тож у базі нічого не з'являється.
-- Запуск: вставити текст міграції + цей блок в ОДИН запит SQL Editor / execute_sql.
-- Очікуваний результат: повідомлення «TESTRESULT ... ALL PASSED», жодного рядка «FAIL».
do $test$
declare
  res text := '';
  v jsonb; n int; s text;
  t0 timestamptz := now() - interval '5 minutes';
  rows3 jsonb := '[{"w":"ODESA","k":"SRK20ZS-W","n":"SRK20ZS-W","p":5,"a":3},
                   {"w":"KYIV_GORENICHI","k":"SRK20ZS-W","n":"SRK20ZS-W","p":10,"a":7},
                   {"w":"DNIPRO","k":"SRC20ZS-W","n":"SRC20ZS-W","p":2,"a":1}]';
  rows_clamp jsonb := '[{"w":"ODESA","k":"X","n":"X","p":2,"a":5},
                        {"w":"KYIV_GORENICHI","k":"Y","n":"Y","p":4,"a":4},
                        {"w":"DNIPRO","k":"Z","n":"Z","p":1,"a":0}]';
  u_odesa uuid; u_dnipro uuid; u_super uuid; u_user uuid;
  fails int := 0;
begin
  select id into u_odesa  from public.profiles where role = 'regional_admin' and region_id = 2 and status = 'approved' limit 1;
  select id into u_dnipro from public.profiles where role = 'regional_admin' and region_id = 6 and status = 'approved' limit 1;
  select id into u_super  from public.profiles where role = 'super_admin' and status = 'approved' limit 1;
  select id into u_user   from public.profiles where role = 'user' and status = 'approved' limit 1;

  -- ---- приймання зрізу ----
  v := public.stock_apply_snapshot(rows3, t0, 'h1', '{"received":3,"ignored":2,"errors":0}');
  s := v->>'status'; res := res || E'\nA перший зріз: ' || s; if s <> 'ok' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot(rows3, t0 + interval '1 minute', 'h1', '{"received":3}');
  s := v->>'status'; res := res || E'\nB той самий хеш: ' || s; if s <> 'unchanged' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot('[]', now(), 'h2', '{}');
  s := v->>'status' || '/' || coalesce(v->>'reason',''); res := res || E'\nC порожній: ' || s; if s <> 'rejected/empty' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot(rows3, t0 - interval '1 hour', 'h3', '{}');
  s := v->>'status' || '/' || coalesce(v->>'reason',''); res := res || E'\nD старіший за застосований: ' || s; if s <> 'rejected/older_than_applied' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot(rows3, now() + interval '1 hour', 'h4', '{}');
  s := v->>'status' || '/' || coalesce(v->>'reason',''); res := res || E'\nE з майбутнього: ' || s; if s <> 'rejected/timestamp_in_future' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot('[{"w":"ODESA","k":"A","n":"A","p":1,"a":1}]', now(), 'h5', '{}');
  s := v->>'status' || '/' || coalesce(v->>'reason',''); res := res || E'\nF надто малий (1 з 3): ' || s; if s <> 'rejected/snapshot_too_small' then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot(rows3, now(), 'h6', '{"received":3,"errors":1}');
  s := v->>'status' || '/' || coalesce(v->>'reason',''); res := res || E'\nG забагато помилкових рядків: ' || s; if s <> 'rejected/too_many_bad_rows' then fails := fails + 1; res := res || ' FAIL'; end if;

  select count(*) into n from public.stock_levels;
  res := res || E'\nH після відхилень старі залишки на місці (3 рядки): ' || n; if n <> 3 then fails := fails + 1; res := res || ' FAIL'; end if;

  v := public.stock_apply_snapshot(rows_clamp, now(), 'h7', '{"received":3,"clamped":1}');
  s := v->>'status'; res := res || E'\nI новий валідний зріз (вільно > всього обрізається): ' || s; if s <> 'ok' then fails := fails + 1; res := res || ' FAIL'; end if;
  select available into n from public.stock_levels where item_key = 'X';
  res := res || E'\nJ available для X = ' || coalesce(n::text, 'NULL') || ' (очікувано 2)'; if n is distinct from 2 then fails := fails + 1; res := res || ' FAIL'; end if;

  -- ---- видимість за ролями ----
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  v := public.get_stock();
  res := res || E'\nK гість: ' || coalesce(v::text, 'null'); if v is not null then fails := fails + 1; res := res || ' FAIL'; end if;

  if u_user is not null then
    perform set_config('request.jwt.claim.sub', u_user::text, true);
    v := public.get_stock();
    res := res || E'\nL звичайний user: ' || coalesce(v::text, 'null'); if v is not null then fails := fails + 1; res := res || ' FAIL'; end if;
  else res := res || E'\nL пропущено (нема user)'; end if;

  if u_odesa is not null then
    perform set_config('request.jwt.claim.sub', u_odesa::text, true);
    v := public.get_stock();
    select count(*) into n from jsonb_array_elements(v->'warehouses');
    res := res || E'\nM адмін Одеси: складів ' || n || ' (очікувано 4: Одеса + 3 київські), рядків ' || jsonb_array_length(v->'rows') || ' (очікувано 2: X,Y)';
    if n <> 4 or jsonb_array_length(v->'rows') <> 2 or exists (select 1 from jsonb_array_elements(v->'rows') r where r->>'w' = 'DNIPRO') then fails := fails + 1; res := res || ' FAIL'; end if;
  else res := res || E'\nM пропущено (нема адміна Одеси)'; end if;

  if u_dnipro is not null then
    perform set_config('request.jwt.claim.sub', u_dnipro::text, true);
    v := public.get_stock();
    res := res || E'\nN адмін Дніпра: рядків ' || jsonb_array_length(v->'rows') || ' (очікувано 2: Y,Z), без ODESA';
    if jsonb_array_length(v->'rows') <> 2 or exists (select 1 from jsonb_array_elements(v->'rows') r where r->>'w' = 'ODESA') then fails := fails + 1; res := res || ' FAIL'; end if;
  else res := res || E'\nN пропущено (нема адміна Дніпра)'; end if;

  if u_super is not null then
    perform set_config('request.jwt.claim.sub', u_super::text, true);
    v := public.get_stock();
    select count(*) into n from jsonb_array_elements(v->'warehouses');
    res := res || E'\nO супер-адмін: складів ' || n || ' (очікувано 8), рядків ' || jsonb_array_length(v->'rows') || ' (очікувано 3)';
    if n <> 8 or jsonb_array_length(v->'rows') <> 3 then fails := fails + 1; res := res || ' FAIL'; end if;
    v := public.get_stock_sync_log(5);
    res := res || E'\nP журнал для супер-адміна: ' || jsonb_array_length(v->'log') || ' записів';
    if v is null or jsonb_array_length(v->'log') < 1 then fails := fails + 1; res := res || ' FAIL'; end if;
  else res := res || E'\nO/P пропущено (нема super_admin)'; end if;

  if u_odesa is not null then
    perform set_config('request.jwt.claim.sub', u_odesa::text, true);
    v := public.get_stock_sync_log(5);
    res := res || E'\nQ журнал для регіонального адміна: ' || coalesce(v::text, 'null'); if v is not null then fails := fails + 1; res := res || ' FAIL'; end if;
  end if;

  -- ---- права доступу ----
  res := res || E'\nR anon може get_stock: ' || has_function_privilege('anon', 'public.get_stock()', 'execute');
  if has_function_privilege('anon', 'public.get_stock()', 'execute') then fails := fails + 1; res := res || ' FAIL'; end if;
  res := res || E'\nS authenticated може stock_apply_snapshot: ' || has_function_privilege('authenticated', 'public.stock_apply_snapshot(jsonb,timestamptz,text,jsonb)', 'execute');
  if has_function_privilege('authenticated', 'public.stock_apply_snapshot(jsonb,timestamptz,text,jsonb)', 'execute') then fails := fails + 1; res := res || ' FAIL'; end if;
  res := res || E'\nT service_role може stock_apply_snapshot: ' || has_function_privilege('service_role', 'public.stock_apply_snapshot(jsonb,timestamptz,text,jsonb)', 'execute');
  if not has_function_privilege('service_role', 'public.stock_apply_snapshot(jsonb,timestamptz,text,jsonb)', 'execute') then fails := fails + 1; res := res || ' FAIL'; end if;
  res := res || E'\nU authenticated читає stock_levels напряму: ' || has_table_privilege('authenticated', 'public.stock_levels', 'select');
  if has_table_privilege('authenticated', 'public.stock_levels', 'select') or has_table_privilege('anon', 'public.stock_sync_log', 'select') then fails := fails + 1; res := res || ' FAIL'; end if;

  select count(*) into n from public.stock_sync_log;
  res := res || E'\nV записів у журналі: ' || n || ' (очікувано 8: по одному на кроки A–G та I)'; if n <> 8 then fails := fails + 1; res := res || ' FAIL'; end if;

  raise exception 'TESTRESULT %', case when fails = 0 then 'ALL PASSED' else fails || ' FAILED' end || res;
end $test$;
