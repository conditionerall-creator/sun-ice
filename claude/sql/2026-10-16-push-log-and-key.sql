-- Сповіщення (push): журнал відправки + прибирання головного ключа з тригера.
-- Застосовано в Supabase 2026-10-16 (міграції push_log_and_registration_trigger_without_service_key,
-- push_log_cleanup_cron, get_push_health_for_diagnostics). Цей файл = те, що реально в базі.
--
-- ПРИВІД. Скарга: «сповіщення про нову реєстрацію приходять лише коли зайшов у застосунок».
-- Розслідування показало три речі:
--   1) функція send-registration-push ковтала ВСІ помилки відправки й завжди відповідала 200 "ok" —
--      відрізнити «доставлено» від «усі підписки мертві» було неможливо;
--   2) троє адміністраторів не мали жодної підписки — їм push не йшов узагалі;
--   3) у тілі тригера відкритим текстом лежав service_role — ключ повного доступу в обхід RLS.

-- ───────────────────────────────── 1. Журнал відправки ─────────────────────────────────
create table if not exists public.push_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  kind          text not null,              -- 'registration' | 'promo' | 'test'
  user_id       uuid,                       -- кому призначалось
  endpoint_tail text,                       -- хвіст адреси пристрою: розрізняти пристрої, не зберігаючи адресу цілком
  platform      text,                       -- 'android' | 'apple' | 'other'
  status        int,                        -- код від сервера пушів (201 — прийнято)
  ok            boolean not null default false,
  error         text,
  subject       text
);

create index if not exists push_log_created_idx on public.push_log (created_at desc);

alter table public.push_log enable row level security;

-- Читає лише супер-адмін. Пише сервіс-роль з Edge Function (вона RLS обходить).
drop policy if exists "push_log select super_admin" on public.push_log;
create policy "push_log select super_admin" on public.push_log
  for select using (public.current_role() = 'super_admin');

-- Автоочистка: успішні 30 днів, помилки 180 (як у stock_sync_log).
select cron.schedule(
  'push_log_cleanup',
  '35 3 * * *',
  $$ delete from public.push_log
      where (ok and created_at < now() - interval '30 days')
         or created_at < now() - interval '180 days' $$
);

-- ──────────────────────── 2. Тригер без головного ключа ────────────────────────
-- Шлюзу Supabase потрібен лише ДІЙСНИЙ ключ, а службовий Edge Function бере зі свого оточення
-- сама. Тому ставимо ПУБЛІЧНИЙ ключ — так само, як у сусідньому notify_new_promotion,
-- який від початку працює саме так. service_role у базі більше ніде не зберігається.
create or replace function public.notify_new_registration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://pwyeifgjfyymhhvzigcg.supabase.co/functions/v1/send-registration-push',
    body := jsonb_build_object('type', 'INSERT', 'table', 'profiles', 'record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_CFO8bbjiwrqfnTiuPf2SJg_r9Zt-cke'
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$function$;

-- ───────────────── 3. Зведення для самодіагностики (лише super_admin) ─────────────────
-- Окрема функція потрібна тому, що push_subscriptions кожен бачить лише свої (RLS), а
-- діагностиці треба відповісти на питання «хто з адмінів узагалі без підписки».
-- Назовні не йдуть ні адреси пристроїв, ні ключі — лише імена, лічильники й коди помилок.
create or replace function public.get_push_health()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'super_admin' then return null; end if;

  return jsonb_build_object(
    'admins', (select count(*) from public.profiles
                where role in ('regional_admin','super_admin') and status = 'approved'),
    'admins_no_subs', (select coalesce(jsonb_agg(x.full_name order by x.full_name), '[]'::jsonb) from (
                         select p.full_name
                           from public.profiles p
                          where p.role in ('regional_admin','super_admin') and p.status = 'approved'
                            and not exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
                       ) x),
    'subs', (select count(*) from public.push_subscriptions),
    'sent7', (select count(*) from public.push_log where ok and created_at > now() - interval '7 days'),
    'failed7', (select count(*) from public.push_log where not ok and created_at > now() - interval '7 days'),
    'last_ok', (select max(created_at) from public.push_log where ok),
    'errors', (select coalesce(jsonb_agg(t.e), '[]'::jsonb) from (
                 select distinct coalesce(status::text, '—') || ': ' || left(coalesce(error, ''), 90) as e
                   from public.push_log
                  where not ok and created_at > now() - interval '7 days'
                  limit 5
               ) t)
  );
end $function$;

-- ─────────────────────────────── Як перевірити вручну ───────────────────────────────
-- Надіслати тестове сповіщення КОНКРЕТНІЙ людині (функція має режим test_user_id):
--
-- select net.http_post(
--   url := 'https://pwyeifgjfyymhhvzigcg.supabase.co/functions/v1/send-registration-push',
--   body := jsonb_build_object('test_user_id', '<uuid профілю>'),
--   headers := jsonb_build_object('Content-Type','application/json',
--                                 'Authorization','Bearer sb_publishable_CFO8bbjiwrqfnTiuPf2SJg_r9Zt-cke')
-- );
-- Через кілька секунд: select * from net._http_response order by id desc limit 1;  → sent/failed
-- І сам журнал:        select * from public.push_log order by created_at desc limit 10;
