// Supabase Edge Function: stock-sync — приймає файл залишків з 1С (xlsx/csv) і записує зріз у БД.
//
// ЯК ВИКЛИКАЄ 1С:   POST https://<проєкт>.supabase.co/functions/v1/stock-sync
//                   Authorization: Bearer <STOCK_SYNC_TOKEN>
//                   Тіло запиту = вміст файлу (xlsx або csv), без обгорток.
//   ?dry_run=1      лише розібрати й перевірити, у БД НІЧОГО не писати (відповідь — зведення).
//   ?source=manual  позначка в журналі, що файл завантажено вручну (адмін-панель).
//
// ВІДПОВІДІ: 200 {ok:true,status:'ok'|'unchanged',...} · 422 {ok:false,status:'rejected',reason} (зріз
//   підозрілий, старі залишки лишились) · 400 (файл не розібрано) · 401 (токен) · 413 · 500.
//   Причина відхилення чи помилки завжди пишеться в stock_sync_log.
//
// СЕКРЕТИ (Supabase → Edge Functions → Secrets): STOCK_SYNC_TOKEN — довгий випадковий рядок, відомий лише
//   1С та нам. SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY Supabase додає сам. Токен у Git/фронт не потрапляє.
//
// ДЕПЛОЙ: verify_jwt = FALSE (1С не вміє Supabase-JWT; захист — власний токен). Це свідоме відхилення від решти
//   функцій проєкту (див. claude/stock-1c/01-АУДИТ-І-АРХІТЕКТУРА.md, B-8). Файли: index.ts, parse.ts, prepare.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSXns from 'npm:xlsx@0.18.5';
import { parseWorkbook } from './parse.ts';
import { prepareRows, hashRows, whKey } from './prepare.ts';

// deno-lint-ignore no-explicit-any
const XLSX: any = (XLSXns as any).default ?? XLSXns;

const TOKEN = Deno.env.get('STOCK_SYNC_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_BYTES = 8 * 1024 * 1024; // звіт на ~1100 рядків важить ~45 КБ; 8 МБ — стеля з великим запасом

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

// Порівняння токена за постійний час (через SHA-256 однакової довжини).
async function tokenOk(header: string | null): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m || !TOKEN) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(m[1].trim())),
    crypto.subtle.digest('SHA-256', enc.encode(TOKEN)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!TOKEN) return json(500, { ok: false, error: 'not_configured' }); // секрет не заданий — не приймаємо нічого
  if (!(await tokenOk(req.headers.get('authorization')))) return json(401, { ok: false, error: 'unauthorized' });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const source = url.searchParams.get('source') === 'manual' ? 'manual' : '1c';
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const fail = async (status: number, reason: string) => {
    if (!dryRun) {
      try { await sb.rpc('stock_log_failure', { p_reason: reason, p_http_status: status, p_source: source, p_duration_ms: Date.now() - t0 }); } catch (_) { /* журнал не повинен ламати відповідь */ }
    }
    // Деталі помилок сервера — лише в журнал; назовні для 5xx — коротко.
    return json(status, { ok: false, status: 'error', reason: status >= 500 ? 'server_error' : reason });
  };

  try {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return await fail(413, 'file_too_large');
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.length === 0) return await fail(400, 'empty_body');
    if (body.length > MAX_BYTES) return await fail(413, 'file_too_large');

    let parsed;
    try {
      parsed = parseWorkbook(XLSX, body);
    } catch (e) {
      return await fail(400, 'parse_error: ' + (e instanceof Error ? e.message : String(e)));
    }
    // Підсумки складів у самому звіті мають збігатися з сумою рядків — інакше розбір зламаний (змінився вигляд звіту).
    if (parsed.mismatches.length > 0) return await fail(422, 'checksum_mismatch: ' + parsed.mismatches.slice(0, 3).join('; '));

    const { data: whs, error: whErr } = await sb.from('stock_warehouses').select('code, name_1c');
    if (whErr || !whs) return await fail(500, 'warehouses_unavailable');
    const whByName = new Map<string, string>(whs.map((w: { code: string; name_1c: string }) => [whKey(w.name_1c), w.code]));

    const prep = prepareRows(parsed, whByName);
    const hash = await hashRows(prep.rows);
    const meta = {
      received: prep.received, ignored: prep.ignored, errors: prep.errors, clamped: prep.clamped, merged: prep.merged,
      source, http_status: 200, started_at: new Date(t0).toISOString(),
    };

    if (dryRun) {
      const perWarehouse: Record<string, { rows: number; physical: number; available: number }> = {};
      for (const r of prep.rows) {
        const w = (perWarehouse[r.w] ??= { rows: 0, physical: 0, available: 0 });
        w.rows++; w.physical += r.p; w.available += r.a;
      }
      return json(200, {
        ok: true, dry_run: true, format: parsed.format, generated_at: parsed.generatedAt?.toISOString() ?? null,
        received: prep.received, accepted: prep.rows.length, ignored: prep.ignored, errors: prep.errors,
        clamped: prep.clamped, merged: prep.merged, ignored_warehouses: prep.ignoredWarehouses,
        warnings: parsed.warnings, per_warehouse: perWarehouse, hash,
      });
    }

    const { data, error } = await sb.rpc('stock_apply_snapshot', {
      p_rows: prep.rows, p_generated_at: parsed.generatedAt?.toISOString() ?? null, p_hash: hash, p_meta: meta,
    });
    if (error) return await fail(500, 'apply_failed: ' + error.message);

    const status = data?.status as string;
    if (status === 'rejected') return json(422, { ok: false, status, reason: data.reason, received: prep.received });
    return json(200, { ok: true, status, accepted: data.accepted, ignored: prep.ignored, errors: prep.errors, duration_ms: Date.now() - t0 });
  } catch (e) {
    // Деталі — лише в журнал; назовні — коротко, без стеку.
    return await fail(500, 'internal_error: ' + (e instanceof Error ? e.message : String(e)));
  }
});
