-- =====================================================================
-- 2026-10-18 (етап D) — Публічна копія прайсу БЕЗ ЦІН + видача гостям
-- =====================================================================
-- Навіщо. З етапом D застосунок перестає качати price.xlsx на старті й читає
-- готові дані. Але get_price() віддає їх лише тому, хто має доступ до цін —
-- отже ГІСТЬ лишився б узагалі без каталогу, хоча сьогодні він бачить назви
-- моделей (без цін). Тому при публікації зберігаємо ДВІ копії:
--   data        — повна, з цінами (get_price, лише для тих, кому можна);
--   data_public — та сама, але без жодної ціни (get_price_public, усім).
--
-- Копію без цін рахує БРАУЗЕР АДМІНА тією самою stripPricesFromSheets(), що вже
-- роками працює для кеша на пристрої. Другої реалізації не заводимо: розійдуться.
--
-- ⚠️ Це НЕ захист цін від зацікавленої людини, а рівно те саме, що застосунок
-- робив досі. Поки price.xlsx лежить у публічному бакеті, будь-хто качає повний
-- прайс за прямим посиланням (борг №2, закривається етапом E).
-- =====================================================================

alter table public.price_versions
  add column if not exists data_public jsonb;

-- Старий варіант із 8 параметрами прибираємо: інакше PostgREST отримає дві
-- функції з однаковою назвою й різним числом аргументів, і виклик стане
-- неоднозначним.
drop function if exists public.price_create_draft(jsonb, jsonb, jsonb, integer, text, text, text, text);

create or replace function public.price_create_draft(
  p_data jsonb, p_data_public jsonb default null,
  p_stats jsonb default '{}'::jsonb, p_diff jsonb default '{}'::jsonb,
  p_parser_version integer default null, p_app_build text default null,
  p_source_name text default null, p_source_sha256 text default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint; v_prev bigint;
begin
  if not public.price_is_manager() then
    insert into public.price_audit (action, ok, reason, actor, actor_role)
    values ('refused', false, 'create_draft: not a super_admin', auth.uid(), public."current_role"());
    return jsonb_build_object('ok', false, 'error', 'only_super_admin');
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    insert into public.price_audit (action, ok, reason, actor, actor_role)
    values ('refused', false, 'create_draft: data is not an object', auth.uid(), public."current_role"());
    return jsonb_build_object('ok', false, 'error', 'bad_data');
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.price_versions where idempotency_key = p_idempotency_key;
    if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'repeated', true); end if;
  end if;

  select current_version_id into v_prev from public.price_state where id = 1;

  insert into public.price_versions (status, data, data_public, stats, diff, parser_version,
         app_build, source_name, source_sha256, idempotency_key, created_by, prev_version_id)
  values ('draft', p_data, p_data_public, coalesce(p_stats,'{}'::jsonb), coalesce(p_diff,'{}'::jsonb),
          p_parser_version, p_app_build, p_source_name, p_source_sha256,
          p_idempotency_key, auth.uid(), v_prev)
  returning id into v_id;

  insert into public.price_audit (action, from_version, to_version, ok, actor, actor_role)
  values ('draft', v_prev, v_id, true, auth.uid(), public."current_role"());

  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- ---------- Каталог БЕЗ ЦІН — доступний усім, навіть без входу ----------
-- Рівно те, що гість бачить сьогодні: назви, групування, характеристики; цін немає.
create or replace function public.get_price_public()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_id bigint; v_row public.price_versions%rowtype;
begin
  select current_version_id into v_id from public.price_state where id = 1;
  if v_id is null then return null; end if;
  select * into v_row from public.price_versions where id = v_id;
  if v_row.id is null or v_row.data_public is null then return null; end if;
  return jsonb_build_object('version_id', v_row.id, 'published_at', v_row.published_at,
                            'stats', v_row.stats, 'data', v_row.data_public, 'stripped', true);
end; $$;

-- ---------- Версія опублікованого прайсу — теж усім ----------
-- Легка перевірка «чи є новіше». Гостю вона потрібна рівно так само, як дилерові,
-- інакше він не дізнається, що прайс оновився. Жодних цін тут немає.
create or replace function public.get_price_version_public()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_id bigint; v_at timestamptz; v_has boolean;
begin
  select ps.current_version_id, pv.published_at, (pv.data_public is not null)
    into v_id, v_at, v_has
    from public.price_state ps left join public.price_versions pv on pv.id = ps.current_version_id
   where ps.id = 1;
  if v_id is null then return null; end if;
  return jsonb_build_object('version_id', v_id, 'published_at', v_at, 'has_public', coalesce(v_has, false));
end; $$;

revoke all on function public.price_create_draft(jsonb, jsonb, jsonb, jsonb, integer, text, text, text, text) from anon, public;
grant execute on function public.price_create_draft(jsonb, jsonb, jsonb, jsonb, integer, text, text, text, text) to authenticated;

revoke all on function public.get_price_public() from public;
grant execute on function public.get_price_public() to anon, authenticated;

revoke all on function public.get_price_version_public() from public;
grant execute on function public.get_price_version_public() to anon, authenticated;
