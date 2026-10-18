-- =====================================================================
-- 2026-10-19 — Фото серій переїжджають з Excel в окреме сховище
-- =====================================================================
-- Навіщо. Фото серій (ті, що відкриваються дотиком по ⓘ біля назви серії) досі
-- лежали ВСЕРЕДИНІ price.xlsx — 102 потрібні картинки на 5,79 МБ. Через це будь-який
-- дотик по ⓘ тягнув увесь 10-мегабайтний файл, і — головне — **закрити публічний
-- бакет було неможливо**: разом із прайсом зникли б і фото.
--
-- Тепер при публікації супер-адмін вивантажує ці картинки в окремий бакет
-- `price-media`, а у версії прайсу зберігається готова мапа
--     { "<аркуш>": { "<назва серії>": ["<адреса>", ...] } }.
-- Застосунок бере фото просто за адресою: ~60 КБ замість 10 МБ.
--
-- Бакет `price-media` ПУБЛІЧНИЙ — і це свідомо. Там фотографії обладнання, а не
-- ціни; саме такі знімки лежать і на сайті компанії. Публічність дає безкоштовне
-- кешування на CDN і прибирає всю мороку з підписаними посиланнями.
-- =====================================================================

alter table public.price_versions
  add column if not exists media jsonb;

-- ---------- Бакет для фото ----------
insert into storage.buckets (id, name, public)
values ('price-media', 'price-media', true)
on conflict (id) do update set public = true;

drop policy if exists "public read price media" on storage.objects;
create policy "public read price media" on storage.objects
  for select using (bucket_id = 'price-media');

drop policy if exists "Super admin uploads price media" on storage.objects;
create policy "Super admin uploads price media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'price-media' and exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'super_admin' and status = 'approved')
  );

drop policy if exists "Super admin replaces price media" on storage.objects;
create policy "Super admin replaces price media" on storage.objects
  for update to authenticated using (
    bucket_id = 'price-media' and exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'super_admin' and status = 'approved')
  ) with check (
    bucket_id = 'price-media' and exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'super_admin' and status = 'approved')
  );

-- ---------- Чернетка приймає мапу фото ----------
drop function if exists public.price_create_draft(jsonb, jsonb, jsonb, jsonb, integer, text, text, text, text);

create or replace function public.price_create_draft(
  p_data jsonb, p_data_public jsonb default null, p_media jsonb default null,
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

  insert into public.price_versions (status, data, data_public, media, stats, diff, parser_version,
         app_build, source_name, source_sha256, idempotency_key, created_by, prev_version_id)
  values ('draft', p_data, p_data_public, p_media, coalesce(p_stats,'{}'::jsonb), coalesce(p_diff,'{}'::jsonb),
          p_parser_version, p_app_build, p_source_name, p_source_sha256,
          p_idempotency_key, auth.uid(), v_prev)
  returning id into v_id;

  insert into public.price_audit (action, from_version, to_version, ok, actor, actor_role)
  values ('draft', v_prev, v_id, true, auth.uid(), public."current_role"());

  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- ---------- Видача: мапа фото їде разом із даними ----------
-- Фото однакові для всіх, тому вони і в повній копії, і в публічній.
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
                            'stats', v_row.stats, 'data', v_row.data, 'media', v_row.media);
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
                            'stats', v_row.stats, 'data', v_row.data_public,
                            'media', v_row.media, 'stripped', true);
end; $$;

revoke all on function public.price_create_draft(jsonb, jsonb, jsonb, jsonb, jsonb, integer, text, text, text, text) from anon, public;
grant execute on function public.price_create_draft(jsonb, jsonb, jsonb, jsonb, jsonb, integer, text, text, text, text) to authenticated;


-- =====================================================================
-- 2026-10-19 (пізніше) — версія прайсу повідомляє, чи є в ній фото
-- =====================================================================
-- Навіщо. Перевірка «чи перенесені фото» дивилась на копію, яку застосунок уже
-- тримає в памʼяті. Одразу після публікації там ще СТАРА версія — і перевірка
-- чесно, але неправильно казала «фото немає», хоча щойно опублікована версія їх
-- має. Тепер про фото питаємо сервер, а не власну памʼять.
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
                            'has_media', coalesce(v_media, false));
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
                            'has_media', coalesce(v_media, false));
end; $$;
