// Supabase Edge Function: send-registration-push
// Викликається тригером trg_notify_new_registration при новому записі в profiles (і при повторній реєстрації).
// Надсилає push адміністраторам: super_admin — усім, regional_admin — свого регіону.
//
// ЖУРНАЛ (додано 2026-10-16). До цього функція ковтала ВСІ помилки відправки й завжди відповідала 200 "ok":
// відрізнити «доставлено» від «усі підписки мертві» було неможливо. Тепер кожна спроба пишеться в public.push_log
// (кому, на який пристрій, який код відповів Google/Apple), а відповідь містить підсумок sent/failed.
//
// РЕЖИМ ПЕРЕВІРКИ: body {"test_user_id": "<uuid>"} — надіслати тестове сповіщення ЛИШЕ цьому користувачеві.
// Потрібно, щоб перевірити конкретний телефон, не чекаючи на справжню реєстрацію й не смікаючи решту адмінів.
//
// ⚠️ ЦЕЙ ФАЙЛ — КОПІЯ ТОГО, ЩО ЗАДЕПЛОЄНО (знято 2026-10-19 з боєвого проєкту, версія 7).
// Міняєш тут — не забудь задеплоїти; міняєш у Dashboard — онови цей файл.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:info@sun-ice.com.ua";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const platformOf = (endpoint: string) =>
  endpoint.includes("apple") ? "apple" : (endpoint.includes("fcm") || endpoint.includes("google")) ? "android" : "other";

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));

    // ---- режим перевірки одного пристрою ----
    const testUserId = payload.test_user_id as string | undefined;

    let adminIds: string[] = [];
    let title = "Нова заявка на реєстрацію";
    let body = "";
    let kind = "registration";

    if (testUserId) {
      adminIds = [testUserId];
      title = "Перевірка сповіщень";
      body = "Якщо ви бачите це повідомлення — push на цьому пристрої працює.";
      kind = "test";
    } else {
      const record = payload.record;
      if (!record) return json({ ok: false, reason: "no record" });
      // super_admin — усім; regional_admin — лише свого регіону
      const { data: admins, error: aerr } = await supabase
        .from("profiles")
        .select("id, role, region_id")
        .or(`role.eq.super_admin,and(role.eq.regional_admin,region_id.eq.${record.region_id})`);
      if (aerr) return json({ ok: false, reason: "admins query failed: " + aerr.message });
      adminIds = (admins || []).map((a: { id: string }) => a.id);
      body = (record.full_name || "") + "\n" + (record.phone || "");
    }

    if (adminIds.length === 0) return json({ ok: true, sent: 0, failed: 0, reason: "no admins to notify" });

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", adminIds);

    if (!subs || subs.length === 0) return json({ ok: true, sent: 0, failed: 0, reason: "no subscriptions" });

    const payloadStr = JSON.stringify({ title, body, url: "/#cabinet", tag: kind === "test" ? "sunice-test" : undefined });

    const results = await Promise.all(subs.map(async (s: { user_id: string; endpoint: string; p256dh: string; auth: string }) => {
      const base = {
        kind, user_id: s.user_id, subject: title,
        endpoint_tail: s.endpoint.slice(-24), platform: platformOf(s.endpoint),
      };
      try {
        const r = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadStr
        );
        return { ...base, status: (r as { statusCode?: number }).statusCode ?? 201, ok: true, error: null };
      } catch (err) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        // Підписка більше не дійсна (застосунок видалили/скинули) — прибираємо її з бази
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
        return { ...base, status: e.statusCode ?? null, ok: false, error: String(e.body || e.message || err).slice(0, 300) };
      }
    }));

    // Журнал не повинен ламати відправку: якщо запис не вдався, просто йдемо далі.
    try { await supabase.from("push_log").insert(results); } catch (_) { /* ignore */ }

    const sent = results.filter((r) => r.ok).length;
    return json({ ok: true, kind, sent, failed: results.length - sent,
                  statuses: results.map((r) => ({ p: r.platform, s: r.status })) });
  } catch (e) {
    return json({ ok: false, reason: "error: " + (e as Error).message });
  }
});
