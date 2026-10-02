// Тест обробника index.ts без Deno і Supabase: підставляємо заглушки замість Deno.*, supabase-js і npm:xlsx.
// Запуск: XLSX_DIR=<папка з xlsx> STOCK_FILE=<Выгрузка.xlsx> node handler.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire((process.env.XLSX_DIR || '.') + '/');
const xlsxEntry = require.resolve('xlsx');

// Копія index.ts у тимчасовій папці з підміненими імпортами (npm: → заглушки).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksync-'));
for (const f of ['parse.ts', 'prepare.ts']) fs.copyFileSync(path.join(here, f), path.join(tmp, f));
fs.writeFileSync(path.join(tmp, 'stub-supabase.mjs'), `
  export const calls = [];
  export let applyResult = { status: 'ok', accepted: 0 };
  export const setApply = (r) => { applyResult = r; };
  export const WH = [
    ['Основной Одесса','ODESA'],['Основной Днепр','DNIPRO'],['Основной Киев (Гореничи) С-А','KYIV_GORENICHI'],
    ['Дополнительный Золотоноша','KYIV_ZOLOTONOSHA'],['Дополнительный Малин','KYIV_MALYN'],
    ['Основной Харьков','KHARKIV'],['Основной Львов','LVIV'],['Основной Запорожье','ZAPORIZHZHIA']];
  export function createClient() {
    return {
      from: () => ({ select: async () => ({ data: WH.map(([name_1c, code]) => ({ code, name_1c })), error: null }) }),
      rpc: async (fn, args) => { calls.push({ fn, args }); return fn === 'stock_apply_snapshot' ? { data: { ...applyResult, accepted: args.p_rows.length }, error: null } : { data: null, error: null }; },
    };
  }`);
let src = fs.readFileSync(path.join(here, 'index.ts'), 'utf8')
  .replace("from 'npm:@supabase/supabase-js@2'", "from './stub-supabase.mjs'")
  .replace("import * as XLSXns from 'npm:xlsx@0.18.5';", `import * as XLSXns from ${JSON.stringify(pathToFileURL(xlsxEntry).href)};`);
fs.writeFileSync(path.join(tmp, 'index.ts'), src);

let handler;
globalThis.Deno = {
  env: { get: (k) => ({ STOCK_SYNC_TOKEN: 'secret-token', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] },
  serve: (h) => { handler = h; },
};
await import(pathToFileURL(path.join(tmp, 'index.ts')).href);
const stub = await import(pathToFileURL(path.join(tmp, 'stub-supabase.mjs')).href);

const call = (body, { token = 'secret-token', method = 'POST', qs = '' } = {}) =>
  handler(new Request('http://localhost/functions/v1/stock-sync' + qs, { method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: method === 'POST' ? body : undefined }));
const file = process.env.STOCK_FILE ? fs.readFileSync(process.env.STOCK_FILE) : null;

// --- захист ---
assert.equal((await call('x', { method: 'GET' })).status, 405);
assert.equal((await call('x', { token: null })).status, 401);
assert.equal((await call('x', { token: 'wrong' })).status, 401);
assert.equal(stub.calls.length, 0, 'без токена нічого не пишемо навіть у журнал');

// --- некоректне тіло ---
let r = await call(new Uint8Array(0));
assert.equal(r.status, 400);
r = await call('a;b\n1;2\n');
assert.equal(r.status, 400);
assert.match((await r.json()).reason, /заголовків|parse_error/);
assert.ok(stub.calls.some((c) => c.fn === 'stock_log_failure'), 'збій розбору потрапляє в журнал');

if (file) {
  // --- dry run: нічого не пишемо ---
  stub.calls.length = 0;
  r = await call(file, { qs: '?dry_run=1' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.dry_run, true);
  assert.equal(d.accepted, 904);
  assert.equal(d.ignored, 223);
  assert.equal(d.per_warehouse.DNIPRO.available, 520);
  assert.equal(d.generated_at, '2026-10-02T10:17:27.000Z');
  assert.equal(stub.calls.length, 0, 'dry_run не пише в БД');

  // --- справжній запис ---
  r = await call(file);
  assert.equal(r.status, 200);
  const ok = await r.json();
  assert.equal(ok.status, 'ok');
  const apply = stub.calls.find((c) => c.fn === 'stock_apply_snapshot');
  assert.equal(apply.args.p_rows.length, 904);
  assert.equal(apply.args.p_generated_at, '2026-10-02T10:17:27.000Z');
  assert.equal(apply.args.p_meta.ignored, 223);
  assert.match(apply.args.p_hash, /^[0-9a-f]{64}$/);

  // --- БД відхилила зріз → 422 з причиною ---
  stub.setApply({ status: 'rejected', reason: 'snapshot_too_small' });
  r = await call(file);
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { ok: false, status: 'rejected', reason: 'snapshot_too_small', received: 1127 });
}
console.log('handler.test: усе пройшло');
