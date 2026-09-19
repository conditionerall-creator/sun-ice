-- ============================================================================
-- ВІДПОВІДЬ ОТРИМАНА 2026-09-19 — ПИТАННЯ ЗАКРИТО, МІГРАЦІЯ НЕ ПОТРІБНА.
--
--   profiles_id_fkey : public.profiles.id -> auth.users : ON DELETE CASCADE
--
-- Тобто видалення облікового запису прибирає й рядок profiles. Застосунок при
-- наступній перевірці отримує PGRST116 ("рядка немає") -> hasFullAccess = false,
-- ціни ховаються і кеш прайсу знецінюється. Видалення діє так само швидко, як і
-- блокування: перевіряється профіль, а не токен, тому "живий" ще JWT ролі не грає.
--
-- Заодно з тієї ж вибірки (це НЕ проблеми, просто фіксую, щоб не перевіряти вдруге):
--   profiles_promo_ack_id_fkey -> public.promotions : SET NULL    — коректно;
--   profiles_region_id_fkey    -> public.regions    : NO ACTION   — коректно, це
--     захист від видалення регіону, у якому ще числяться користувачі. У виводі
--     запиту нижче цей рядок підписаний як "проблема" ПОМИЛКОВО: підписи в CASE
--     писались під зв'язок з auth.users і до region_id не стосуються.
--
-- Запит 2 (осиротілі профілі) дав 0.
-- ============================================================================

-- 2026-09-19 — ПЕРЕВІРКА (нічого не міняє, тільки читає).
--
-- Навіщо: адмінка вміє видаляти користувача (Edge Function admin-delete-user). Питання,
-- на яке репозиторій відповіді не має: чи зникає разом з обліковим записом рядок у
-- public.profiles? Від цього залежить, чи справді видалений втрачає доступ до цін.
--
--   * Якщо ON DELETE = CASCADE — рядок profiles зникає разом з auth.users. Застосунок
--     тоді бачить "профілю немає" і ховає ціни одразу (PGRST116 → доступу немає).
--   * Якщо ON DELETE = NO ACTION/RESTRICT або зовнішнього ключа немає — рядок profiles
--     лишається висіти зі статусом 'approved'. Поки не помре сесія (до години), сервер
--     на запит статусу відповідатиме "approved", і застосунок показуватиме ціни.
--
-- Виконати в Supabase → SQL Editor, результат усіх трьох запитів надіслати Claude.

-- 1) Чи є зовнішній ключ profiles.id → auth.users.id і яке в нього правило видалення.
--    delete_rule: 'CASCADE' — добре; 'NO ACTION' / порожній результат — проблема.
select
  tc.constraint_name,
  kcu.column_name          as profiles_column,
  ccu.table_schema || '.' || ccu.table_name as references_table,
  ccu.column_name          as references_column,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
 and kcu.constraint_schema = tc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
 and rc.constraint_schema = tc.constraint_schema
where tc.table_schema = 'public'
  and tc.table_name = 'profiles'
  and tc.constraint_type = 'FOREIGN KEY';

-- 2) Чи вже є "осиротілі" профілі — рядки profiles без облікового запису в auth.users.
--    Якщо тут не 0, значить видалення користувачів профілі не прибирає (або не прибирало
--    раніше), і ці рядки треба почистити окремо.
select count(*) as orphaned_profiles
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;

-- 3) Ті самі осиротілі рядки детально (щоб бачити, кого саме і з яким статусом).
--    Якщо запит 2 дав 0 — цей поверне порожньо, це нормально.
select p.id, p.phone, p.status, p.role, p.created_at
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null
order by p.created_at desc
limit 50;
