-- =====================================================================
-- 2026-11-18 — крок 2: get_price()* доливають позиції price_extras і віддають extras_rev
-- =====================================================================
-- Виконувати ЛИШЕ разом із заливкою застосунку APP_BUILD ≥ 2026-11-18.3 (той, що звіряє extras_rev
-- і не рахує позиції "extra" зниклими при публікації). Таблиця й функції — 2026-11-18-price-extras.sql.
-- Відкат: виконати знову відповідні функції з 2026-10-19-price-media.sql (там вони без доливання).

-- ---------- get_price / get_price_public: те саме, що було (2026-10-19-price-media.sql), + доливання ----------
create or replace function public.get_price()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_status text; v_rereg timestamptz;
        v_allowed boolean; v_id bigint; v_row public.price_versions%rowtype;
begin
  if v_uid is null then return null; end if;
  select status, reregistered_at into v_status, v_rereg from public.profiles where id = v_uid;
  v_allowed := v_status is not null
               and v_status not in ('blocked','rejected')
               and not (v_status = 'pending' and v_rereg is not null);
  if not v_allowed then return null; end if;
  select current_version_id into v_id from public.price_state where id = 1;
  if v_id is null then return null; end if;
  select * into v_row from public.price_versions where id = v_id;
  if v_row.id is null then return null; end if;
  return jsonb_build_object('version_id', v_row.id, 'published_at', v_row.published_at,
                            'stats', v_row.stats, 'data', public.price_extras_merge(v_row.data, true),
                            'media', v_row.media, 'extras_rev', public.price_extras_rev());
end; $$;

create or replace function public.get_price_public()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_id bigint; v_row public.price_versions%rowtype;
begin
  select current_version_id into v_id from public.price_state where id = 1;
  if v_id is null then return null; end if;
  select * into v_row from public.price_versions where id = v_id;
  if v_row.id is null or v_row.data_public is null then return null; end if;
  return jsonb_build_object('version_id', v_row.id, 'published_at', v_row.published_at,
                            'stats', v_row.stats, 'data', public.price_extras_merge(v_row.data_public, false),
                            'media', v_row.media, 'stripped', true, 'extras_rev', public.price_extras_rev());
end; $$;

create or replace function public.get_price_version()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_status text; v_rereg timestamptz;
        v_allowed boolean; v_id bigint; v_at timestamptz; v_media boolean;
begin
  if v_uid is null then return null; end if;
  select status, reregistered_at into v_status, v_rereg from public.profiles where id = v_uid;
  v_allowed := v_status is not null
               and v_status not in ('blocked','rejected')
               and not (v_status = 'pending' and v_rereg is not null);
  if not v_allowed then return null; end if;
  select ps.current_version_id, pv.published_at,
         (pv.media is not null and pv.media <> '{}'::jsonb)
    into v_id, v_at, v_media
    from public.price_state ps left join public.price_versions pv on pv.id = ps.current_version_id
   where ps.id = 1;
  if v_id is null then return null; end if;
  return jsonb_build_object('version_id', v_id, 'published_at', v_at,
                            'has_media', coalesce(v_media, false), 'extras_rev', public.price_extras_rev());
end; $$;

create or replace function public.get_price_version_public()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_id bigint; v_at timestamptz; v_has boolean; v_media boolean;
begin
  select ps.current_version_id, pv.published_at, (pv.data_public is not null),
         (pv.media is not null and pv.media <> '{}'::jsonb)
    into v_id, v_at, v_has, v_media
    from public.price_state ps left join public.price_versions pv on pv.id = ps.current_version_id
   where ps.id = 1;
  if v_id is null then return null; end if;
  return jsonb_build_object('version_id', v_id, 'published_at', v_at,
                            'has_public', coalesce(v_has, false),
                            'has_media', coalesce(v_media, false), 'extras_rev', public.price_extras_rev());
end; $$;

-- Права на виклик — як були (create or replace їх не скидає, але повторюємо явно).
revoke all on function public.get_price() from public, anon;
grant execute on function public.get_price() to authenticated;
revoke all on function public.get_price_version() from public, anon;
grant execute on function public.get_price_version() to authenticated;
revoke all on function public.get_price_public() from public;
grant execute on function public.get_price_public() to anon, authenticated;
revoke all on function public.get_price_version_public() from public;
grant execute on function public.get_price_version_public() to anon, authenticated;

