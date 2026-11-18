// Перевірка стратегії кешування sw.js без браузера: мережа й кеш підмінені.
// Запуск: node claude/sw/tests/sw.test.mjs   (з кореня репозиторію)
// Що стережемо (2026-11-18):
//   • файл з ?v= (і CDN з @x.y.z) у кеші — мережу НЕ чіпаємо зовсім;
//   • такого файлу ще немає в кеші — беремо з мережі й кладемо в кеш;
//   • сторінка: мережа повільна, копія є — віддаємо копію після таймауту, а свіжа сторінка
//     все одно доїжджає в кеш;
//   • сторінка: копії немає (перший запуск) — чекаємо мережу, хоч і довго;
//   • сторінка: мережі немає — копія;
//   • решта статики — як раніше: кеш одразу + фонове оновлення.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const TIMEOUT = 60; // у тесті замість 3000 мс
const src = fs.readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8')
  .replace('const HTML_NET_TIMEOUT_MS = 3000;', 'const HTML_NET_TIMEOUT_MS = ' + TIMEOUT + ';');
assert.ok(src.includes('HTML_NET_TIMEOUT_MS = ' + TIMEOUT), 'у sw.js не знайдено HTML_NET_TIMEOUT_MS = 3000');

const SCOPE = 'https://app.example/';
function makeEnv() {
  const store = new Map();                  // url → body
  const net = { calls: [], handler: null }; // handler(url) → Promise<Response>
  const listeners = {};
  class Res {
    constructor(body, ok = true) { this.body = body; this.ok = ok; }
    clone() { return new Res(this.body, this.ok); }
    static error() { return new Res('ERROR', false); }
  }
  const cache = {
    match: async (r) => { const u = typeof r === 'string' ? r : r.url; return store.has(u) ? new Res(store.get(u)) : undefined; },
    put: async (r, res) => { store.set(typeof r === 'string' ? r : r.url, res.body); },
    keys: async () => [...store.keys()].map(url => ({ url })),
    delete: async (r) => store.delete(r.url)
  };
  const ctx = {
    self: {
      registration: { scope: SCOPE },
      addEventListener: (t, fn) => { listeners[t] = fn; },
      skipWaiting: () => {}, clients: { claim: () => {} }
    },
    caches: { open: async () => cache, match: (r) => cache.match(r), keys: async () => [], delete: async () => true },
    fetch: (r) => { const u = typeof r === 'string' ? r : r.url; net.calls.push(u); return net.handler(u); },
    URL, Response: Res, Promise, setTimeout, clearTimeout, console
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { store, net, listeners, Res };
}

function fire(env, url, { navigate = false } = {}) {
  let responded = null; const waits = [];
  const req = { url, method: 'GET', mode: navigate ? 'navigate' : 'no-cors', headers: { get: () => navigate ? 'text/html' : '*/*' } };
  env.listeners.fetch({ request: req, respondWith: (p) => { responded = Promise.resolve(p); }, waitUntil: (p) => waits.push(p) });
  return { responded, waits };
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
let n = 0;
async function test(name, fn) { await fn(); n++; console.log('  ✓ ' + name); }

await test('файл з ?v= у кеші — мережу не чіпаємо', async () => {
  const env = makeEnv();
  const u = SCOPE + 'js/04-catalog.js?v=2026-11-18.5';
  env.store.set(u, 'CACHED');
  env.net.handler = async () => new env.Res('NET');
  const { responded } = fire(env, u);
  assert.equal((await responded).body, 'CACHED');
  await delay(5);
  assert.equal(env.net.calls.length, 0, 'була фонова перевірка: ' + env.net.calls);
});

await test('CDN з точною версією — так само без мережі', async () => {
  const env = makeEnv();
  const u = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
  env.store.set(u, 'CACHED');
  env.net.handler = async () => new env.Res('NET');
  assert.equal((await fire(env, u).responded).body, 'CACHED');
  await delay(5);
  assert.equal(env.net.calls.length, 0);
});

await test('файлу з ?v= ще немає — з мережі й у кеш', async () => {
  const env = makeEnv();
  const u = SCOPE + 'data/specs-split-mhi.json?v=2026-11-18.5';
  env.net.handler = async () => new env.Res('NET');
  assert.equal((await fire(env, u).responded).body, 'NET');
  await delay(5);
  assert.equal(env.store.get(u), 'NET');
});

await test('звичайна статика — кеш одразу + фонове оновлення (як було)', async () => {
  const env = makeEnv();
  const u = SCOPE + 'icon-192.png';
  env.store.set(u, 'OLD');
  env.net.handler = async () => new env.Res('NEW');
  assert.equal((await fire(env, u).responded).body, 'OLD');
  await delay(5);
  assert.equal(env.net.calls.length, 1);
  assert.equal(env.store.get(u), 'NEW');
});

await test('сторінка: мережа повільна, копія є — копія після таймауту, свіжа доїжджає в кеш', async () => {
  const env = makeEnv();
  env.store.set(SCOPE, 'OLD-PAGE');
  env.net.handler = () => delay(TIMEOUT * 4).then(() => new env.Res('NEW-PAGE'));
  const t0 = Date.now();
  const { responded, waits } = fire(env, SCOPE, { navigate: true });
  const res = await responded;
  const took = Date.now() - t0;
  assert.equal(res.body, 'OLD-PAGE');
  assert.ok(took >= TIMEOUT - 5 && took < TIMEOUT * 3, 'віддано за ' + took + ' мс');
  assert.equal(waits.length, 1, 'немає waitUntil — свіжа сторінка може не доїхати в кеш');
  await Promise.all(waits);
  assert.equal(env.store.get(SCOPE), 'NEW-PAGE');
});

await test('сторінка: мережа швидка — свіжа сторінка, як раніше', async () => {
  const env = makeEnv();
  env.store.set(SCOPE, 'OLD-PAGE');
  env.net.handler = async () => new env.Res('NEW-PAGE');
  assert.equal((await fire(env, SCOPE, { navigate: true }).responded).body, 'NEW-PAGE');
});

await test('сторінка: копії немає (перший запуск) — чекаємо мережу довше таймауту', async () => {
  const env = makeEnv();
  env.net.handler = () => delay(TIMEOUT * 3).then(() => new env.Res('NEW-PAGE'));
  assert.equal((await fire(env, SCOPE, { navigate: true }).responded).body, 'NEW-PAGE');
});

await test('сторінка: мережі немає — копія (або index.html)', async () => {
  const env = makeEnv();
  env.store.set(SCOPE + 'index.html', 'INDEX');
  env.net.handler = async () => { throw new Error('offline'); };
  assert.equal((await fire(env, SCOPE + '?utm=1', { navigate: true }).responded).body, 'INDEX');
});

await test('Supabase — повз service worker', async () => {
  const env = makeEnv();
  const { responded } = fire(env, 'https://pwy.supabase.co/rest/v1/rpc/get_price');
  assert.equal(responded, null);
});

console.log('\nsw.test: усе пройшло (' + n + ')');
