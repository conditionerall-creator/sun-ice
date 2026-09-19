// Supabase Edge Function: reregister-user
// Деплой: Supabase Dashboard → Edge Functions → reregister-user → Code → вставити цей
// код → Deploy updates. Секретів окремо задавати не треба — SUPABASE_URL і
// SUPABASE_SERVICE_ROLE_KEY Supabase додає автоматично до кожної функції.
//
// УВАГА: це ЄДИНА копія коду функції в репозиторії. До 2026-09-19 код Edge Functions
// існував тільки всередині Supabase. Якщо правиш функцію в Dashboard — онови й цей файл,
// інакше знову залишиться без джерела правди.
//
// ─────────────────────────────────────────────────────────────────────────────
// ВЕРСІЯ 2026-09-19. Що змінилось проти першої версії і чому.
//
// Перша версія на "Забули пароль" ВИДАЛЯЛА старий auth-акаунт і створювала новий.
// Через це було три проблеми:
//
//   1. ОБХІД БЛОКУВАННЯ. Новий рядок profiles створювався зі status='pending', а
//      'pending' у застосунку дає повний доступ до цін. Тобто заблокований дилер
//      натискав "Забули пароль", вводив свій номер і будь-який новий пароль — і знову
//      бачив ціни. Сама позначка про блокування при цьому стиралась разом зі старим
//      рядком.
//   2. ВТРАТА ДАНИХ CRМОНТАЖУ. installer_tasks.installer_id → profiles(id) стоїть з
//      ON DELETE CASCADE, а profiles.id → auth.users теж CASCADE. Тому видалення
//      акаунта знищувало ВСІ монтажі людини (і, за тією ж схемою, постачальників).
//      Монтажник, який просто забув пароль, втрачав усю свою робочу базу без
//      попередження й без можливості відновити.
//   3. ВТРАТА РОЛІ Й ТИПУ ЦІН. Новий рядок писався з role='user', price_type='regular'.
//      Тобто regional_admin, який забув пароль, ставав звичайним користувачем, а
//      індивідуальний тип цін скидався на стандартний.
//
// Тепер функція НЕ видаляє нічого. Вона міняє пароль наявному акаунту
// (admin.updateUserById) і оновлює в профілі тільки ім'я, регіон і reregistered_at.
// role, price_type, монтажі, постачальники — лишаються недоторканими.
//
// Плюс дві поведінкові зміни, погоджені з користувачем 2026-09-19:
//
//   * Заблокованим і відхиленим (status 'blocked'/'rejected') зміна пароля НЕ дається
//     взагалі — 403 і текст "зверніться до адміністратора". Це закриває обхід.
//   * Решті пароль міняється одразу (людина входить), але статус ставиться 'pending'
//     разом з reregistered_at — і застосунок ховає ціни, поки адмін не підтвердить
//     ("варіант з підтвердженням"). Саме комбінація pending + reregistered_at ≠ null
//     означає "чекає підтвердження після зміни пароля"; у звичайної нової реєстрації
//     reregistered_at порожній, тому вона, як і раніше, бачить ціни одразу.
//     Клієнтська частина цієї логіки — profileAllowsPrices() в index.html.
//
// Чому окремий статус не заводили: 'pending' + reregistered_at дає той самий результат
// без міграції БД і без ризику наштовхнутись на CHECK-обмеження колонки status.
//
// Що ця функція НЕ вирішує: номер телефону ніяк не підтверджується (ні SMS, ні дзвінка),
// тому будь-хто, хто знає чужий номер, усе ще може змінити пароль на свій. Але тепер це
// не знищує дані й не дає цін — доступ відкриє тільки адмін, який побачить у панелі
// повторну заявку. Технічний захист номера — окреме майбутнє рішення (SMS-код).
// ─────────────────────────────────────────────────────────────────────────────
//
// Вхід:  { phone, full_name, password, region_id }
// Вихід: { user_id } | { error }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Статуси, яким зміна пароля через цю функцію заборонена.
const REREGISTER_DENIED_STATUSES = ["blocked", "rejected"];

function phoneToEmail(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  return "p" + digits + "@sunice.local";
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const fullName = String(body.full_name || "").trim();
    const password = String(body.password || "");
    const regionId = Number(body.region_id);

    if (!phone || !fullName || !password || !regionId || password.length < 6) {
      return new Response(JSON.stringify({ error: "invalid input" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile, error: findErr } = await supabase
      .from("profiles")
      .select("id, status")
      .eq("phone", phone)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!profile) {
      return new Response(JSON.stringify({ error: "account not found for this phone" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Заблокованим і відхиленим — відмова. Пароль не міняємо, статус не чіпаємо, нічого
    // не видаляємо. Клієнт розпізнає цю відповідь за словом "blocked" і показує людині
    // "зверніться до адміністратора" (див. handleReregister в index.html).
    if (REREGISTER_DENIED_STATUSES.includes(profile.status)) {
      return new Response(JSON.stringify({ error: "account blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Міняємо пароль наявному акаунту. НЕ видаляємо і не створюємо заново — інакше
    // каскадом полетять монтажі (див. коментар вгорі).
    const { error: pwdErr } = await supabase.auth.admin.updateUserById(profile.id, {
      password: password,
      email: phoneToEmail(phone),
      email_confirm: true,
    });
    if (pwdErr) throw pwdErr;

    // В профілі оновлюємо тільки те, що людина щойно ввела, плюс позначки заявки.
    // role і price_type НЕ чіпаємо — вони лишаються такими, якими їх поставив адмін.
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        region_id: regionId,
        status: "pending",
        reregistered_at: new Date().toISOString(),
      })
      .eq("id", profile.id);
    if (profileErr) throw profileErr;

    return new Response(JSON.stringify({ user_id: profile.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && (e as any).message) || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
