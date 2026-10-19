// Supabase Edge Function: admin-delete-user
// Викликається з Кабінету кнопкою "Видалити" (тільки regional_admin / super_admin).
// Видаляє акаунт користувача ПОВНІСТЮ (auth + профіль), щоб номер телефону звільнився
// і людина могла зареєструватися заново.
//
// ⚠️ ЦЕЙ ФАЙЛ — КОПІЯ ТОГО, ЩО ЗАДЕПЛОЄНО (знято 2026-10-19 з боєвого проєкту,
// версія 4). Міняєш тут — не забудь задеплоїти; міняєш у Dashboard — онови цей файл.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Без цих заголовків браузер блокує запит ще до того, як він долетить до функції
// (службовий preflight-запит OPTIONS не отримує дозволу) — саме це і спричиняло
// "Failed to send a request to the Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id required" }, 400);

    // Клієнт "від імені того, хто викликає" — щоб через RLS дізнатись його реальну роль
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData } = await callerClient.auth.getUser();
    const caller = userData?.user;
    if (!caller) return json({ error: "unauthorized" }, 401);

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role, region_id")
      .eq("id", caller.id)
      .single();

    if (!callerProfile || (callerProfile.role !== "super_admin" && callerProfile.role !== "regional_admin")) {
      return json({ error: "forbidden" }, 403);
    }

    if (caller.id === user_id) {
      return json({ error: "cannot delete yourself" }, 400);
    }

    // Службовий клієнт (повний доступ) — тільки для самої дії видалення, після перевірки прав вище
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (callerProfile.role === "regional_admin") {
      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("region_id, role")
        .eq("id", user_id)
        .single();
      if (!targetProfile || targetProfile.region_id !== callerProfile.region_id || targetProfile.role === "super_admin") {
        return json({ error: "forbidden" }, 403);
      }
    }

    const { error } = await adminClient.auth.admin.deleteUser(user_id);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
