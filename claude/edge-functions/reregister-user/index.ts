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
// ВЕРСІЯ 2026-09-20. ГОЛОВНЕ: додано CORS — без нього функція була недосяжна.
//
// Симптом: у застосунку "Забули пароль" завжди показував "Не вдалося змінити пароль".
// Причина НЕ в логіці функції: браузер перед POST шле preflight-запит OPTIONS, а
// функція не віддавала заголовок Access-Control-Allow-Origin. Браузер скасовував
// запит, і supabase-js повертав FunctionsFetchError ("Failed to send a request to the
// Edge Function") — клієнт показував загальну помилку. У логах Supabase такий виклик
// навіть не з'являвся.
//
// Цього блоку не було і в найпершій версії функції, тому кнопка "Забули пароль",
// найімовірніше, НЕ працювала з застосунку ніколи. Сусідня admin-delete-user, яку теж
// викликають з браузера, CORS має — саме її патерн тут і скопійовано.
//
// Пастка для майбутнього: перевірка функції через curl НЕ ловить цю поломку, бо curl
// не робить preflight. Перевіряти треба з браузера з того самого origin, де живе
// застосунок (GitHub Pages).
//
// ВЕРСІЯ 2026-09-19 (залишається чинною). Раніше на "Забули пароль" функція ВИДАЛЯЛА
// старий auth-акаунт і створювала новий. Три біди:
//
//   1. ОБХІД БЛОКУВАННЯ. Новий рядок profiles створювався зі status='pending', а
//      'pending' у застосунку дає повний доступ до цін.
//   2. ВТРАТА ДАНИХ CRМОНТАЖУ. installer_tasks.installer_id → profiles(id) стоїть з
//      ON DELETE CASCADE, а profiles.id → auth.users теж CASCADE. Видалення акаунта
//      знищувало ВСІ монтажі людини (і постачальників).
//   3. ВТРАТА РОЛІ Й ТИПУ ЦІН. Новий рядок писався з role='user',
//      price_type='regular'.
//
// Тепер функція нічого не видаляє: міняє пароль наявному акаунту
// (admin.updateUserById). Заблокованим і відхиленим відмовляє (403). Решті ставить
// status='pending' + reregistered_at, і застосунок ховає ціни до підтвердження
// адміністратором (див. profileAllowsPrices() в index.html).
//
// ЧОМУ НЕ ЧІПАЄМО region_id (виправлено 2026-09-20). У БД на profiles висить тригер
// trg_prevent_role_region_change:
//
//     if (new.role is distinct from old.role
//         or new.region_id is distinct from old.region_id) then
//       if public.current_role() <> 'super_admin' then raise exception ... ;
//
// Тобто регіон має право міняти тільки super_admin. Якби функція записувала region_id
// з форми, то (а) при виборі іншого регіону оновлення падало б з винятком, і (б) це
// був би обхід самого правила — людина міняла б собі регіон через "забув пароль".
// Тому регіон і роль лишаються такими, як були; у формі поле регіону прибрано.
// ─────────────────────────────────────────────────────────────────────────────
//
// Вхід:  { phone, full_name, password }   (region_id, якщо прийде, ігнорується)
// Вихід: { user_id } | { error }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Той самий набір, що в admin-delete-user. Без нього браузер не пропускає виклик.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Статуси, яким зміна пароля через цю функцію заборонена.
const REREGISTER_DENIED_STATUSES = ["blocked", "rejected"];

function phoneToEmail(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  return "p" + digits + "@sunice.local";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const fullName = String(body.full_name || "").trim();
    const password = String(body.password || "");

    if (!phone || !fullName || !password || password.length < 6) {
      return new Response(JSON.stringify({ error: "invalid input" }), {
        status: 400,
        headers: jsonHeaders,
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
        headers: jsonHeaders,
      });
    }

    // Заблокованим і відхиленим — відмова. Пароль не міняємо, статус не чіпаємо, нічого
    // не видаляємо. Клієнт розпізнає цю відповідь за словом "blocked" і показує людині
    // "зверніться до адміністратора" (див. handleReregister в index.html).
    if (REREGISTER_DENIED_STATUSES.includes(profile.status)) {
      return new Response(JSON.stringify({ error: "account blocked" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    // Міняємо пароль наявному акаунту. НЕ видаляємо і не створюємо заново — інакше
    // каскадом полетять монтажі (див. коментар вгорі).
    const { error: pwdErr } = await supabase.auth.admin.updateUserById(profile.id, {
      password: password,
    });
    if (pwdErr) throw pwdErr;

    // role, price_type і region_id НЕ чіпаємо (див. коментар про тригер вгорі).
    // status='pending' + reregistered_at = "чекає підтвердження після зміни пароля";
    // на цю пару полів реагують і profileAllowsPrices() в застосунку, і тригер
    // trg_notify_reregistration, який шле push адміністраторам.
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        status: "pending",
        reregistered_at: new Date().toISOString(),
      })
      .eq("id", profile.id);
    if (profileErr) throw profileErr;

    return new Response(JSON.stringify({ user_id: profile.id }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (e) {
    console.error("reregister-user failed:", e);
    return new Response(JSON.stringify({ error: String((e && (e as any).message) || e) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
