// Supabase Edge Function: check-site-links
// Деплой: Supabase Dashboard → Edge Functions → Deploy a new function → назва check-site-links →
// вставити цей код → Deploy. Секретів задавати не треба (SUPABASE_URL і SUPABASE_ANON_KEY
// Supabase додає сам). verify_jwt лишити УВІМКНЕНИМ (за замовчуванням) — функцію викликає лише
// застосунок із сесією супер-адміна, і сама перевіряє роль.
//
// ЩО РОБИТЬ. Браузер не може читати сторінки sun-ice.com.ua (сайт не віддає CORS), тому
// самодіагностика застосунку («Перевірити зараз» в Кабінеті) просить цю функцію перевірити сайт
// з боку сервера. Вхід — таблиця посилань, яку застосунок уже має (data/site-links.json):
//   { table: { links, noCard, knownSlugs, unlisted } }
// Вихід: { checked, problems: [{ kind, line, url, list, marking }], note }
//
// ПЕРЕВІРКИ:
//   1. Для кожного посилання на картку: вона є в лістингу категорії сайту, а її артикул/назва
//      містить маркування застосунку → інакше error («картка зникла/перейменована/інший товар»).
//      Картки, яких нема в лістингу, але які були такими й на момент збірки (table.unlisted), мовчать,
//      якщо відкриваються (HTTP 200); якщо ні — error.
//   2. Посилання-пошуки (FDE50VH SRC50ZSX тощо) — пошук має повертати ≥ 1 товар.
//   3. Нові картки в лістингах, яких не було на момент збірки (table.knownSlugs) → warning.
//   4. Нова картка збігається з маркуванням, яке в застосунку було «без картки» (table.noCard) →
//      warning «з'явилась картка — перебудуйте таблицю».
// Джерело даних лістингу: прихований список #product_price_wrap (назва / артикул / ціна) на сторінках
// категорій з ?limit=100 — не потрібно качати сотні карток.
//
// Файл написано без TypeScript-синтаксису, щоб логіку можна було прогнати в Node (див. CHANGELOG
// 2026-10-02) — Deno.serve і createClient підключаються лише під Deno.

const SITE = "https://sun-ice.com.ua/";
const LISTINGS = [
  { name: "split", path: "split-systemy" },
  { name: "multi", path: "multy-split-systemy" },
  { name: "semi", path: "napivpromyslovi-split-systemy" },
];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEARCH_PREFIX = "index.php?route=product/search&search=";
const FETCH_TIMEOUT_MS = 45000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const TWINS = { "С": "C", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "Т": "T", "Х": "X", "І": "I" };
export function norm(s) {
  const up = String(s || "").toUpperCase().replace(/[–—‑]/g, "-");
  return Array.from(up).map((ch) => TWINS[ch] || ch).join("").replace(/\s+/g, "");
}
function decodeHtml(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
}

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(init || {}), signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}
async function fetchText(url) {
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return await r.text();
}
async function headStatus(url) {
  try {
    const r = await fetchWithTimeout(url, { method: "HEAD" });
    return r.status;
  } catch (e) {
    return 0;
  }
}

// Рядки прихованої таблиці лістингу: <tr id="productNNN"> … href, назва, артикул (p-l-sku), ціна.
export function parseListing(html) {
  const rows = [];
  const re = /<tr id="product(\d+)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[2];
    const link = block.match(/<a href="https:\/\/sun-ice\.com\.ua\/([^"?#\/]+)"[^>]*>\s*([^<]+?)\s*<\/a>/);
    const sku = block.match(/<td class="p-l-sku">\s*([\s\S]*?)\s*<\/td>/);
    if (!link) continue;
    rows.push({ pid: m[1], slug: link[1], name: decodeHtml(link[2]), sku: decodeHtml(sku ? sku[1] : "") });
  }
  return rows;
}
async function loadListing(path) {
  const all = new Map();
  for (let page = 1; page <= 8; page++) {
    const html = await fetchText(SITE + path + "?limit=100&page=" + page);
    const rows = parseListing(html);
    let added = 0;
    rows.forEach((r) => { if (!all.has(r.slug)) { all.set(r.slug, r); added++; } });
    if (!added) break;
  }
  return all;
}

function tokensOf(row) {
  const set = new Set();
  String(row.sku || "").split(/[\/+,;]/).forEach((t) => { const n = norm(t); if (n) set.add(n); });
  String(row.name || "").split(/[\s\/+,;]+/).forEach((t) => { const n = norm(t); if (n) set.add(n); });
  return set;
}
// Частина маркування застосунку збігається з токенами картки. «SRC50ZSX-W2(3)» = ревізія W2 АБО W3.
function partOk(part, tokens) {
  const m = part.match(/^(.*?)W(\d)\((\d)\)$/);
  if (m) return tokens.has(m[1] + "W" + m[2]) || tokens.has(m[1] + "W" + m[3]);
  return tokens.has(part);
}
function markingOk(key, tokens) {
  return String(key).split("+").every((p) => partOk(p, tokens));
}

// Основна логіка. fetchers підмінюються в тестах.
export async function checkSiteLinks(table, fetchers) {
  const f = fetchers || { loadListing, headStatus, fetchText };
  const links = (table && table.links) || {};
  const noCard = (table && table.noCard) || {};
  const known = new Set((table && table.knownSlugs) || []);
  const unlisted = new Set((table && table.unlisted) || []);
  const problems = [];
  const listing = new Map();
  for (const l of LISTINGS) {
    const part = await f.loadListing(l.path);
    part.forEach((v, k) => { if (!listing.has(k)) listing.set(k, v); });
  }
  if (listing.size < 50) {
    // сайт віддав порожній/зламаний лістинг — не засипаємо помилками кожну картку
    return { checked: 0, problems: [{ kind: "error", line: "Лістинги категорій на сайті порожні або змінили розмітку (знайдено " + listing.size + " карток) — перевірку неможливо виконати", url: SITE }], note: "лістинг недоступний" };
  }

  let checked = 0;
  const searches = [];
  const headQueue = [];
  const usedSlugs = new Set();
  for (const list of Object.keys(links)) {
    for (const key of Object.keys(links[list])) {
      const value = String(links[list][key]);
      checked++;
      if (value.indexOf("index.php") === 0) { searches.push({ list, key, value }); continue; }
      if (!SLUG_RE.test(value)) { problems.push({ kind: "error", list, marking: key, line: "некоректна адреса картки в таблиці: " + value }); continue; }
      usedSlugs.add(value);
      const row = listing.get(value);
      const url = SITE + value;
      if (row) {
        if (!markingOk(key, tokensOf(row))) {
          problems.push({ kind: "error", list, marking: key, url, line: "картка на сайті — це вже інший товар: «" + row.name + "» (артикул " + row.sku + ")" });
        }
      } else {
        headQueue.push({ list, key, value, url });
      }
    }
  }
  // Картки поза лістингом: HEAD із обмеженою паралельністю
  for (let i = 0; i < headQueue.length; i += 10) {
    const batch = headQueue.slice(i, i + 10);
    const res = await Promise.all(batch.map((b) => f.headStatus(b.url)));
    res.forEach((status, j) => {
      const b = batch[j];
      if (status === 200) {
        if (!unlisted.has(b.value)) problems.push({ kind: "warning", list: b.list, marking: b.key, url: b.url, line: "картка відкривається, але зникла з лістингу категорії (знята з виробництва або прихована)" });
      } else {
        problems.push({ kind: "error", list: b.list, marking: b.key, url: b.url, line: "картка зникла з сайту (HTTP " + (status || "немає відповіді") + ")" });
      }
    });
  }
  // Посилання-пошуки
  for (const s of searches) {
    try {
      const html = await f.fetchText(SITE + s.value);
      // сторінка пошуку має іншу розмітку, ніж лістинг: картки — блоки class="product-thumb"
      if (!/class="product-thumb/.test(html)) problems.push({ kind: "error", list: s.list, marking: s.key, url: SITE + s.value, line: "пошук по сайту за цим маркуванням нічого не знаходить" });
    } catch (e) {
      problems.push({ kind: "warning", list: s.list, marking: s.key, url: SITE + s.value, line: "не вдалося перевірити пошук: " + (e && e.message ? e.message : e) });
    }
  }
  // Нові картки в лістингах
  const fresh = [];
  listing.forEach((row, slug) => { if (!known.has(slug)) fresh.push(row); });
  fresh.forEach((row) => {
    problems.push({ kind: "warning", url: SITE + row.slug, line: "нова картка на сайті, якої не було в таблиці посилань: «" + row.name + "» (артикул " + row.sku + ")" });
    const tokens = tokensOf(row);
    for (const list of Object.keys(noCard)) {
      (noCard[list] || []).forEach((key) => {
        if (key && markingOk(key, tokens)) {
          problems.push({ kind: "warning", list, marking: key, url: SITE + row.slug, line: "з'явилась картка для маркування, яке було без посилання: «" + row.name + "» — перебудуйте таблицю посилань" });
        }
      });
    }
  });
  return { checked, problems, note: "лістингів: " + listing.size + " карток, пошуків: " + searches.length };
}

if (typeof Deno !== "undefined") {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      // Лише супер-адмін: функція робить десяток важких запитів до сайту
      const auth = req.headers.get("Authorization") || "";
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } } });
      const { data: userData } = await sb.auth.getUser();
      if (!userData || !userData.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
      const { data: profile } = await sb.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
      if (!profile || profile.role !== "super_admin") return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: jsonHeaders });

      const body = await req.json().catch(() => ({}));
      const table = body && body.table;
      if (!table || typeof table.links !== "object") return new Response(JSON.stringify({ error: "invalid input: table.links required" }), { status: 400, headers: jsonHeaders });
      const result = await checkSiteLinks(table);
      return new Response(JSON.stringify(result), { headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }), { status: 500, headers: jsonHeaders });
    }
  });
}
