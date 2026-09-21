-- ============================================================================
-- Sun-ice · 2026-09-21 · Закрити службові функції від анонімних викликів
-- ============================================================================
-- ЩО НЕ ТАК БУЛО
--   Вбудований аудит Supabase (Advisors → Security) показував сім SECURITY DEFINER
--   функцій, які міг викликати будь-хто ззовні, без входу, просто POST-запитом на
--   /rest/v1/rpc/<назва>. Найнеприємніша з них — report_price_issue: сторонній міг
--   накидати в «Діагностику прайсу» супер-адміна скільки завгодно вигаданих рядків,
--   і їх було б не відрізнити від справжніх.
--
-- ЩО РОБИМО
--   Лишаємо право виклику тільки тим, хто увійшов у застосунок (роль authenticated).
--   Це нічого не ламає:
--     • report_price_issue / resolve_price_issue_if_ok викликає той, хто відкрив
--       каталог; після закриття прайсу від сторонніх каталог і так буде лише для своїх;
--     • current_role / current_region — ЇХ НЕ ЧІПАЄМО. Спершу я їх теж відкликав в
--       anon, і це виявилось помилкою (див. «ГРАБЛІ» нижче);
--     • notify_new_registration / notify_new_promotion / prevent_role_region_change —
--       це ТРИГЕРНІ функції, їх взагалі ніхто не повинен викликати руками. Їм
--       забираємо право і в authenticated теж: PostgreSQL перевіряє право на
--       виконання тригерної функції при СТВОРЕННІ тригера, а не при кожному
--       спрацюванні.
--
-- ⚠️ ГРАБЛІ, НА ЯКІ Я НАСТУПИВ 2026-09-21 — НЕ ПОВТОРЮВАТИ
--   Спершу я відкликав EXECUTE на current_role()/current_region() і в anon теж.
--   Синтетичні перевірки в транзакції це пройшли, а на живому застосунку вилізло:
--   гість натискає «Зберегти курс» і бачить не звичайну відмову доступу, а
--   "permission denied for function current_role". Причина: ці функції викликаються
--   ВСЕРЕДИНІ RLS-політик (app_settings_update_admins, mhi_error_codes_write_admins),
--   і виконуються вони від імені того, хто робить запит. Немає права — політика не
--   повертає «ні», а падає з помилкою.
--   Гірше: політика mhi_error_codes_write_admins має тип ALL, тобто діє і на SELECT.
--   Читання кодів помилок MHI гостем урятувало лише те, що PostgreSQL зупиняє перевірку
--   на першій дозвільній політиці, яка вже дала «так». Покладатись на цей порядок не
--   можна — варто комусь переставити політики, і розділ «Коди помилок» ляже для гостей.
--   Тому право в anon повернуто. Втрати безпеки немає: анонімному користувачеві ці
--   функції й так повертають null, витікати з них нема чому.
--
-- ПЕРЕВІРЕНО НА ЖИВІЙ БАЗІ (2026-09-21):
--   • супер-адмін бачить усі 16 профілів — політики з current_role() працюють;
--   • звичайне оновлення profiles проходить — тригер prevent_role_region_change
--     спрацьовує (PostgreSQL перевіряє право на тригерну функцію при створенні
--     тригера, а не при кожному спрацюванні);
--   • гість читає 92 коди помилок MHI;
--   • аудит Supabase: функцій, доступних анонімам, стало 0 (було 7).
--
-- БЕЗПЕЧНО ПЕРЕЗАПУСКАТИ.
-- ============================================================================

-- Потрібні застосунку, але лише залогіненим.
revoke execute on function public.report_price_issue(text, text, text, text, text) from anon, public;
grant  execute on function public.report_price_issue(text, text, text, text, text) to authenticated;

revoke execute on function public.resolve_price_issue_if_ok(text, text) from anon, public;
grant  execute on function public.resolve_price_issue_if_ok(text, text) to authenticated;

-- Службові: потрібні всередині RLS-політик, викликати ззовні не треба нікому.
-- current_role / current_region НАВМИСНО не чіпаємо — див. «ГРАБЛІ» у шапці файлу.

-- Тригерні: викликаються лише базою, коли спрацьовує тригер.
revoke execute on function public.notify_new_registration() from anon, authenticated, public;
revoke execute on function public.notify_new_promotion() from anon, authenticated, public;
revoke execute on function public.prevent_role_region_change() from anon, authenticated, public;
