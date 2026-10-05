// Тест чистої логіки stock.js: зіставлення за основою, пари, основні/додаткові склади, коротка панель, повна інформація
// з фільтрами, аксесуари, свіжість — плюс реальні дані 1С.
// Запуск: XLSX_DIR=<папка з xlsx> STOCK_FILE=<Выгрузка.xlsx> node claude/stock-1c/tests/stock.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const req = createRequire(import.meta.url);
const S = req(path.join(repo, 'stock.js'));

// --- нормалізація, основа, маркування аксесуарів ---
assert.equal(S.normKey('SRС50HE-S1'), 'SRC50HE-S1');           // кирилична «С» у прайсі
assert.equal(S.normKey(' gcz 09hm-s '), 'GCZ09HM-S');
assert.equal(S.baseOf('SRC35ZS-W2'), 'SRC35ZS-W');
assert.equal(S.baseOf('SRK20ZS-WT'), 'SRK20ZS-W');
assert.equal(S.baseOf('GKZ09SH-WS'), 'GKZ09SH-W');
assert.equal(S.baseOf('FDE71VH'), null);
assert.equal(S.baseOf('RC-E5'), null);
assert.equal(S.leadOf('RC-E5, дротовий пульт (підключення через SC-BIKN2-E)'), 'RC-E5');
assert.equal(S.leadOf('Wifi адаптер для LCAC Module Assembly,\nарт. 17310900A06402'), 'Wifi адаптер для LCAC Module Assembly');
assert.equal(S.leadOf('SRK20ZS-W'), 'SRK20ZS-W');

// --- дані: 2 основні + 1 додатковий склад ---
const rows = [
  { k: 'SRC35ZS-W',  n: 'SRC35ZS-W',  w: 'ODESA', p: 5,  a: 4 },
  { k: 'SRC35ZS-W1', n: 'SRC35ZS-W1', w: 'ODESA', p: 9,  a: 8 },
  { k: 'SRC35ZS-W2', n: 'SRC35ZS-W2', w: 'ODESA', p: 14, a: 12 },
  { k: 'SRC35ZS-W2', n: 'SRC35ZS-W2', w: 'KYIV_GORENICHI', p: 30, a: 20 },
  { k: 'SRC35ZS-W2', n: 'SRC35ZS-W2', w: 'KYIV_USED', p: 3, a: 3 },
  { k: 'SRK20ZS-W',  n: 'SRK20ZS-W',  w: 'ODESA', p: 3,  a: 2 },
  { k: 'SRK20ZS-WB', n: 'SRK20ZS-WB', w: 'ODESA', p: 1,  a: 1 },
  { k: 'FDE71VH',    n: 'FDE71VH',    w: 'ODESA', p: 2,  a: 2 },
  { k: 'FDE71VHA',   n: 'FDE71VHA',   w: 'ODESA', p: 7,  a: 7 },
  { k: 'RC-E5',      n: 'RC-E5',      w: 'KYIV_GORENICHI', p: 92, a: 35 },
  { k: 'RC-E5',      n: 'RC-E5',      w: 'KYIV_USED', p: 1, a: 1 },
  { k: 'ONLYUSED-W', n: 'ONLYUSED-W', w: 'KYIV_USED', p: 4, a: 4 },
  { k: 'ZEROMAIN-W', n: 'ZEROMAIN-W', w: 'ODESA', p: 0, a: 0 },
];
const data = {
  warehouses: [
    { code: 'ODESA', name: 'Одеса', kind: 'main', region: 'Одеса' },
    { code: 'KYIV_GORENICHI', name: 'Київ — Гореничі', kind: 'main', region: 'Київ' },
    { code: 'KYIV_USED', name: 'Київ — б/у', kind: 'additional', region: 'Київ' },
  ],
  low_threshold: 2, fresh_minutes: 45, stale_minutes: 120,
  last_success_at: '2026-10-02T10:00:00Z', server_now: '2026-10-02T10:10:00Z', rows,
};
const idx = S.buildIndex(rows);

// --- зіставлення за основою ---
assert.deepEqual(S.matchVariants(idx, 'SRC35ZS-W2').map((x) => [x.k, x.exact]), [['SRC35ZS-W2', true], ['SRC35ZS-W', false], ['SRC35ZS-W1', false]]);
assert.deepEqual(S.matchVariants(idx, 'SRK20ZS-WT').map((x) => x.k), ['SRK20ZS-W', 'SRK20ZS-WB']);
assert.deepEqual(S.matchVariants(idx, 'FDE71VH').map((x) => x.k), ['FDE71VH']);
assert.deepEqual(S.matchVariants(idx, ''), []);

// --- підсумки: ЛИШЕ основні склади; додаткові окремо ---
let sm = S.summarizeParts([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.equal(sm.parts[0].P, 58); assert.equal(sm.parts[0].A, 44);          // Одеса 5+9+14 / 4+8+12 + Київ 30/20, БЕЗ б/у (3/3)
assert.equal(sm.parts[0].PX, 3); assert.equal(sm.parts[0].AX, 3);
assert.equal(sm.status, 'ok');
sm = S.summarizeParts([{ m: 'ONLYUSED-W', role: null }], idx, data);
assert.equal(sm.any, true); assert.equal(sm.parts[0].P, 0); assert.equal(sm.parts[0].PX, 4); assert.equal(sm.status, 'out', 'є лише на додатковому складі → кнопка є, колір червоний');
sm = S.summarizeParts([{ m: 'ZEROMAIN-W', role: null }], idx, data);
assert.equal(sm.any, true); assert.equal(sm.status, 'out', 'нуль на основному складі — це результат, кнопка є');
assert.equal(S.summarizeParts([{ m: 'NOPE-W', role: null }], idx, data).any, false, 'нема в 1С → кнопки нема');

// --- КОРОТКА панель ---
let cv = S.compactView([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.deepEqual(cv.rows.map((r) => [r.name, r.vals[0].p, r.vals[0].a]), [['Одеса', 28, 24], ['Київ — Гореничі', 30, 20]], 'варіанти складені в один рядок на склад');
assert.equal(cv.extra.any, true); assert.deepEqual(cv.extra.vals, [{ p: 3, a: 3 }]);
assert.equal(cv.similar, 2);
cv = S.compactView([{ m: 'ONLYUSED-W', role: null }], idx, data);
assert.equal(cv.rows.length, 0, 'на основних нема — рядків нема'); assert.equal(cv.extra.any, true);
cv = S.compactView([{ m: 'ZEROMAIN-W', role: null }], idx, data);
assert.equal(cv.rows.length, 0, 'склад з нулем у короткій панелі не показується');
cv = S.compactView([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.deepEqual(cv.rows.map((r) => [r.name, r.vals.map((x) => x.a)]), [['Одеса', [3, 24]], ['Київ — Гореничі', [0, 20]]]);

// --- ПОВНА інформація + фільтри ---
const P2 = [{ m: 'SRC35ZS-W2', role: 'outdoor' }];
let fv = S.fullView(P2, idx, data, { kind: 'all', region: 'all', only: false });
assert.equal(fv.parts[0].variants[0].rows.length, 3, 'усі склади, навіть із нулем');
fv = S.fullView(P2, idx, data, { kind: 'main', region: 'all', only: false });
assert.deepEqual(fv.parts[0].variants[0].rows.map((r) => r.code), ['ODESA', 'KYIV_GORENICHI']);
fv = S.fullView(P2, idx, data, { kind: 'additional', region: 'all', only: false });
assert.deepEqual(fv.parts[0].variants[0].rows.map((r) => r.code), ['KYIV_USED']);
fv = S.fullView(P2, idx, data, { kind: 'all', region: 'Київ', only: false });
assert.deepEqual(fv.parts[0].variants[0].rows.map((r) => r.code), ['KYIV_GORENICHI', 'KYIV_USED']);
fv = S.fullView([{ m: 'SRC35ZS-W', role: 'outdoor' }], idx, data, { kind: 'all', region: 'all', only: true });
assert.deepEqual(fv.parts[0].variants.map((v) => [v.name, v.rows.length]), [['SRC35ZS-W', 1], ['SRC35ZS-W1', 1], ['SRC35ZS-W2', 3]], 'лише де є: нульові склади відсіяні');
const fz = S.fullView([{ m: 'ZEROMAIN-W', role: null }], idx, data, { kind: 'all', region: 'all', only: false });
assert.equal(fz.parts[0].variants[0].rows.length, 3); assert.equal(fz.parts[0].variants[0].P, 0);

// --- комплекти ---
const pairSum = S.summarizeParts([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
const kit = S.kitFor(pairSum, data.warehouses);
assert.deepEqual(kit.perWh.map((x) => x.kits), [3, 0, 0]);   // Одеса: min(2+1, 24)=3; Київ: внутр. 0; б/у: внутр. 0
assert.equal(kit.total, 3);
assert.equal(S.kitFor(S.summarizeParts([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data), data.warehouses), null);

// --- частини рядка ---
const splitList = [
  { model: 'SRK20ZT-WF',  unitType: 'indoor', splitOutdoor: 'SRС20ZT-WF' },
  { model: 'SRK20ZT-WFT', unitType: 'indoor' },
  { model: 'RC-E5', unitType: null },
];
assert.deepEqual(S.partsFor(splitList[0], 'split_mhi', splitList), [{ m: 'SRK20ZT-WF', role: 'indoor' }, { m: 'SRС20ZT-WF', role: 'outdoor' }]);
assert.deepEqual(S.partsFor(splitList[1], 'split_mhi', splitList).map((p) => p.m), ['SRK20ZT-WFT', 'SRС20ZT-WF'], 'кольоровий варіант бере зовнішній брата');
assert.deepEqual(S.partsFor({ model: 'RC-E5, дротовий пульт (підключення через SC-BIKN2-E)', unitType: null }, 'semi_mhi', []), [{ m: 'RC-E5', role: null }], 'аксесуар: маркування до коми');
assert.deepEqual(S.partsFor({ model: 'Wifi адаптер для LCAC Module Assembly,\nарт. 17310900A06402' }, 'semi_gal', []).map((p) => p.m), ['Wifi адаптер для LCAC Module Assembly']);
assert.deepEqual(S.partsFor({ model: 'SRK71ZR-W + FDC71VNX-W' }, 'semi_mhi', []).map((p) => [p.m, p.role]), [['SRK71ZR-W', 'indoor'], ['FDC71VNX-W', 'outdoor']]);
assert.deepEqual(S.partsFor({ model: 'GBZ18MLQ-W', outdoorModel: 'GCZ18MLNQ-W', unitType: 'indoor' }, 'semi_gal', []).map((p) => p.role), ['indoor', 'outdoor']);
assert.deepEqual(S.partsFor({ model: 'SCM40ZS-W', unitType: 'outdoor' }, 'multisplit_mhi', []), [{ m: 'SCM40ZS-W', role: 'outdoor' }]);

// --- свіжість ---
const t0 = Date.parse('2026-10-02T10:10:00Z');
assert.equal(S.freshness(data, t0, t0).state, 'fresh');
assert.equal(S.freshness(data, t0, t0 + 60 * 60000).state, 'aging');
assert.equal(S.freshness(data, t0, t0 + 120 * 60000).state, 'stale');
assert.equal(S.freshness({ ...data, last_success_at: null }, t0, t0).state, 'none');
assert.equal(S.fmtAge(0.2), 'щойно'); assert.equal(S.fmtAge(4), '4 хв тому'); assert.equal(S.fmtAge(180), '3 год тому'); assert.equal(S.fmtAge(4000), '3 дн. тому');
assert.equal(S.fmtQty(7), '7'); assert.equal(S.fmtQty(2.5), '2,5');

// --- реальні дані 1С (17 складів) + список позицій застосунку ---
if (process.env.STOCK_FILE) {
  const xl = createRequire((process.env.XLSX_DIR || '.') + '/')('xlsx');
  const { parseWorkbook } = await import(pathToFileURL(path.join(repo, 'claude/edge-functions/stock-sync/parse.ts')).href);
  const { prepareRows, whKey } = await import(pathToFileURL(path.join(repo, 'claude/edge-functions/stock-sync/prepare.ts')).href);
  const W = [['Основной Киев (Гореничи) С-А', 'KYIV_GORENICHI', 'main', 'Київ'], ['Дополнительный Золотоноша', 'KYIV_ZOLOTONOSHA', 'main', 'Київ'], ['Дополнительный Малин', 'KYIV_MALYN', 'main', 'Київ'],
    ['Основной Одесса', 'ODESA', 'main', 'Одеса'], ['Основной Харьков', 'KHARKIV', 'main', 'Харків'], ['Основной Львов', 'LVIV', 'main', 'Львів'], ['Основной Запорожье', 'ZAPORIZHZHIA', 'main', 'Запоріжжя'], ['Основной Днепр', 'DNIPRO', 'main', 'Дніпро'],
    ['Дополнительный б/у', 'KYIV_USED', 'additional', 'Київ'], ['Дополнительный Киев (Потье) С-А', 'KYIV_POTIE', 'additional', 'Київ'], ['САН-АЙС киевский офис', 'KYIV_OFFICE', 'additional', 'Київ'],
    ['Сервисный Центр С-А', 'KYIV_SERVICE', 'additional', 'Київ'], ['Учебный Центр Киев С-А', 'KYIV_TRAINING', 'additional', 'Київ'], ['Склад офис Одесса', 'ODESA_OFFICE', 'additional', 'Одеса'],
    ['Неліквід Харків', 'KHARKIV_NONLIQUID', 'additional', 'Харків'], ['Неліквід Львів', 'LVIV_NONLIQUID', 'additional', 'Львів'], ['Неліквід Дніпро', 'DNIPRO_NONLIQUID', 'additional', 'Дніпро']];
  const WH = new Map(W.map(([n, c]) => [whKey(n), c]));
  const prep = prepareRows(parseWorkbook(xl, new Uint8Array(fs.readFileSync(process.env.STOCK_FILE))), WH);
  const real = { ...data, warehouses: W.map(([, c, k, r]) => ({ code: c, name: c, kind: k, region: r })), rows: prep.rows };
  const ridx = S.buildIndex(real.rows);
  // Донецьк ігнорується повністю: його рядків у даних немає
  assert.ok(!prep.rows.some((r) => /ДОНЕЦ|DONETSK/i.test(r.w)));
  // аксесуари: RC-E5 є (основні склади)
  const rc = S.summarizeParts([{ m: 'RC-E5', role: null }], ridx, real);
  assert.ok(rc.any && rc.parts[0].A > 0, 'пульт RC-E5 знайдено');
  // покриття списку позицій застосунку (дамп 2026-10-02): з аксесуарами
  const dump = JSON.parse(fs.readFileSync(path.join(repo, 'claude/site-catalog/app-dump-2026-10-02.json'), 'utf8'));
  let total = 0, matched = 0;
  for (const [key, items] of Object.entries(dump)) for (const it of items) { total++; if (S.summarizeParts(S.partsFor(it, key, items), ridx, real).any) matched++; }
  console.log('покриття: ' + matched + ' із ' + total);
  assert.ok(matched >= 366, 'очікували ≥366 позицій зі збігом (було 324 без аксесуарів), отримали ' + matched);
  console.log('реальні дані 1С: OK');
}
console.log('stock.test: усе пройшло');
