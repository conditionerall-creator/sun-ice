-- 2026-09-20 — Push адміністраторам при зміні пароля ("Забули пароль"), а не лише при
-- новій реєстрації.
--
-- ПРОБЛЕМА. Сповіщення адмінам вішає тригер trg_notify_new_registration на
-- public.profiles — він AFTER **INSERT**. Стара версія Edge Function reregister-user
-- видаляла акаунт і створювала новий, тому вставка відбувалась і push ішов. Нова версія
-- (2026-09-19) нічого не видаляє, а РОБИТЬ UPDATE наявного рядка — вставки немає, і
-- адміністратор про заявку не дізнається. А оскільки до підтвердження адміном людина
-- сидить без цін, мовчазна заявка означає, що дилер чекатиме невідомо скільки.
--
-- РІШЕННЯ. Не чіпаємо ні наявний тригер, ні саму функцію notify_new_registration() —
-- додаємо ДРУГИЙ тригер на UPDATE, який викликає ту саму функцію.
--
-- Чому це безпечно: перевірено 2026-09-20, тіло notify_new_registration() не звертається
-- ні до NEW, ні до OLD, ні до TG_OP (перевірка через pg_get_functiondef). Тобто функція
-- не залежить від того, INSERT це чи UPDATE, і поводитиметься однаково.
--
-- Чому ДВА окремі тригери, а не один на "insert or update": WHEN-умова нижче звертається
-- до OLD, а для INSERT значення OLD не існує — Postgres не дасть створити такий тригер.
--
-- Умова спрацювання: reregistered_at саме ЗМІНИВСЯ і став непорожнім. Тобто:
--   * звичайне редагування профілю (ім'я, статус, тип цін) push НЕ шле;
--   * підтвердження заявки адміном (status → approved) push НЕ шле;
--   * лише сама подія "людина змінила пароль через Забули пароль".
--
-- Ідемпотентно: можна виконувати повторно.

drop trigger if exists trg_notify_reregistration on public.profiles;

create trigger trg_notify_reregistration
after update of reregistered_at on public.profiles
for each row
when (
  new.reregistered_at is not null
  and new.reregistered_at is distinct from old.reregistered_at
)
execute function public.notify_new_registration();

-- Перевірка: має повернути обидва тригери — старий на INSERT і новий на UPDATE.
select
  t.tgname                                as trigger_name,
  case t.tgtype::int & 4 when 4 then 'INSERT' else '' end ||
  case t.tgtype::int & 16 when 16 then 'UPDATE' else '' end as events,
  p.proname                               as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'profiles'
  and not t.tgisinternal
order by t.tgname;
