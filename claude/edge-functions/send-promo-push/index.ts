// Supabase Edge Function: send-promo-push
// Секрети — ті самі VAPID_*, що в send-registration-push; SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY
// Supabase додає автоматично.
//
// Викликається двома способами (обидва — через pg_net):
//   { mode: 'new', promo_id }  — одразу після додавання нової активної акції: шле push УСІМ
//                                 користувачам з підпискою, незалежно від таймера.
//   { mode: 'reminder' }       — раз на день з pg_cron: лише тим, хто ще не підтвердив НАЙНОВІШУ
//                                 активну акцію і кого не нагадували останні 3 дні.
// В обох випадках оновлює profiles.promo_last_nag_at = now() для всіх, кого зачепило.
//
// ЖУРНАЛ (додано 2026-10-16). Раніше функція рахувала лише `sent`, а будь-яка помилка, крім
// «підписка мертва», зникала безслідно: якщо акція не доходила до половини дилерів, про це ніхто
// не дізнавався. Тепер кожна спроба пишеться в public.push_log (kind = 'promo'), а відповідь містить failed.
//
// ⚠️ ЦЕЙ ФАЙЛ — КОПІЯ ТОГО, ЩО ЗАДЕПЛОЄНО (знято 2026-10-19 з боєвого проєкту, версія 5).
// Міняєш тут — не забудь задеплоїти; міняєш у Dashboard — онови цей файл.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:info@sun-ice.com.ua";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const NAG_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 дні

const platformOf = (endpoint: string) =>
  endpoint.includes("apple") ? "apple" : (endpoint.includes("fcm") || endpoint.includes("google")) ? "android" : "other";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body && body.mode === "new" ? "new" : "reminder";
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Найновіша активна акція визначається за id (він завжди зростає при додаванні),
    // а не за sort_order — sort_order лише регулює порядок показу карток у застосунку.
    const { data: latest, error: latestErr } = await supabase
      .from("promotions")
      .select("id, title")
      .eq("is_active", true)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw latestErr;
    if (!latest) return json({ sent: 0, failed: 0, reason: "no active promotion" });

    const nowIso = new Date().toISOString();
    const nagCutoffIso = new Date(Date.now() - NAG_INTERVAL_MS).toISOString();

    // Кандидати — усі, хто ще НЕ підтвердив саме цю (найновішу) акцію (враховуючи і тих,
    // хто взагалі ще нічого не підтверджував, — promo_ack_id тоді NULL).
    const { data: candidates, error: candErr } = await supabase
      .from("profiles")
      .select("id, promo_ack_id, promo_last_nag_at")
      .or(`promo_ack_id.is.null,promo_ack_id.neq.${latest.id}`);
    if (candErr) throw candErr;

    const targets = (candidates || []).filter((p: { promo_last_nag_at: string | null }) => {
      if (mode === "new") return true; // нова акція — нагадуємо всім одразу, без таймера
      if (!p.promo_last_nag_at) return true;
      return p.promo_last_nag_at < nagCutoffIso;
    });

    if (targets.length === 0) return json({ sent: 0, failed: 0, targeted: 0 });

    const targetIds = targets.map((p: { id: string }) => p.id);
    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", targetIds);
    if (subsErr) throw subsErr;

    const title = "Sun-ice — цікава новина";
    const payload = JSON.stringify({ title, body: latest.title, tag: "sunice-promo", url: "/" });

    const results = await Promise.all((subs || []).map(async (s: { user_id: string; endpoint: string; p256dh: string; auth: string }) => {
      const base = {
        kind: "promo", user_id: s.user_id, subject: title,
        endpoint_tail: s.endpoint.slice(-24), platform: platformOf(s.endpoint),
      };
      try {
        const r = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        return { ...base, status: (r as { statusCode?: number }).statusCode ?? 201, ok: true, error: null };
      } catch (err) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        // Підписка більше недійсна (пристрій відписався/видалив дозвіл) — прибираємо її відразу,
        // за точною адресою (так само, як у send-registration-push).
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
        return { ...base, status: e.statusCode ?? null, ok: false, error: String(e.body || e.message || err).slice(0, 300) };
      }
    }));

    try { await supabase.from("push_log").insert(results); } catch (_) { /* журнал не має ламати розсилку */ }

    // Незалежно від того, чи була в когось із targetIds діюча push-підписка, рахуємо їх
    // "нагаданими" на цей цикл — інакше умова 3 днів ніколи не зрушиться для тих, у кого
    // взагалі немає підписки.
    await supabase.from("profiles").update({ promo_last_nag_at: nowIso }).in("id", targetIds);

    const sent = results.filter((r) => r.ok).length;
    return json({ sent, failed: results.length - sent, targeted: targetIds.length, promo_id: latest.id, mode });
  } catch (e) {
    return json({ error: String((e && (e as { message?: string }).message) || e) }, 500);
  }
});
