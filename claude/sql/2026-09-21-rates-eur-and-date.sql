-- ============================================================================
-- Sun-ice · 2026-09-21 · Курси валют: євро + дата, від якої діє курс + автор
-- ============================================================================
-- ЩО ЦЕ ДАЄ
--   1. Другий курс — євро. Суто інформаційний: у прайсі є позиції в EUR
--      (Systemair, FRICO, REMAK, витратні матеріали), але перерахунок у гривню
--      калькулятор для них НЕ робить — так домовились із користувачем.
--   2. Дата, ВІД ЯКОЇ діє курс. Її вводить адміністратор руками, бачать усі
--      дрібним сірим текстом під курсом.
--   3. Хто і коли востаннє змінював курс. Ставиться АВТОМАТИЧНО тригером, бачать
--      лише адміністратори й супер-адміністратори. Це і є та «персональна
--      відповідальність», про яку просив користувач: підмінити чуже ім'я з
--      клієнта неможливо, бо значення бере сама база з auth.uid().
--
-- ЧОМУ АВТОР ЧЕРЕЗ ТРИГЕР, А НЕ З ЗАСТОСУНКУ
--   Якби ім'я надсилав браузер, будь-хто з правом писати в app_settings міг би
--   підставити туди чуже ім'я. Тригер бере його з profiles за auth.uid().
--
-- ЧОМУ ЗБЕРІГАЄМО ІМ'Я ТЕКСТОМ, А НЕ ПОСИЛАННЯ НА ПРОФІЛЬ
--   RLS на profiles дозволяє регіональному адміну бачити лише СВІЙ регіон. Якби
--   курс змінив адмін іншого регіону, другий адмін не зміг би прочитати його ім'я
--   і побачив би порожнє місце. Текст читають усі, кому видно сам рядок app_settings.
--
-- БЕЗПЕЧНО ПЕРЕЗАПУСКАТИ: усе через IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

alter table public.app_settings add column if not exists eur_rate numeric;
alter table public.app_settings add column if not exists rate_effective_date date;
alter table public.app_settings add column if not exists rate_updated_by_name text;

comment on column public.app_settings.eur_rate is
  'Курс євро до гривні. Тільки для інформації в шапці, у розрахунках не бере участі.';
comment on column public.app_settings.rate_effective_date is
  'Дата, ВІД ЯКОЇ діє курс. Вводить адміністратор вручну. Видно всім.';
comment on column public.app_settings.rate_updated_by_name is
  'Хто востаннє змінив курс. Заповнює тригер trg_stamp_rate_author, руками не писати.';

-- Тригер: при кожній зміні будь-якого з полів курсу проставляє поточний час і
-- ім'я того, хто це зробив. Інші поля app_settings (якщо колись з'являться) не
-- чіпає — щоб службове оновлення не виглядало як «адмін міняв курс».
create or replace function public.stamp_rate_author()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.usd_rate is distinct from old.usd_rate
     or new.eur_rate is distinct from old.eur_rate
     or new.rate_effective_date is distinct from old.rate_effective_date then
    new.updated_at := now();
    new.rate_updated_by_name := coalesce(
      (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()),
      'невідомо'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_rate_author on public.app_settings;
create trigger trg_stamp_rate_author
  before update on public.app_settings
  for each row execute function public.stamp_rate_author();

-- Функція викликається лише як тригер — прямий виклик через REST нікому не потрібен.
-- УВАГА на `public` у списку: CREATE FUNCTION за замовчуванням дає EXECUTE ролі PUBLIC,
-- і відкликання лише в anon/authenticated нічого не змінює — вони успадкують право від
-- PUBLIC. Перший раз я саме так і помилився: аудит Supabase одразу показав функцію
-- серед доступних анонімам. Відкликати треба всі три.
revoke execute on function public.stamp_rate_author() from public, anon, authenticated;
