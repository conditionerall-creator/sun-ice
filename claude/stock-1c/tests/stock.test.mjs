// Тест чистої логіки stock.js (зіставлення за основою, пари, комплекти, свіжість) + реальні дані 1С.
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

// --- нормалізація й основа ---
assert.equal(S.normKey('SRС50HE-S1'), 'SRC50HE-S1');           // кирилична «С» у прайсі
assert.equal(S.normKey(' gcz 09hm-s '), 'GCZ09HM-S');
assert.equal(S.baseOf('SRC35ZS-W2'), 'SRC35ZS-W');
assert.equal(S.baseOf('SRK20ZS-WT'), 'SRK20ZS-W');
assert.equal(S.baseOf('GKZ09SH-WS'), 'GKZ09SH-W');
assert.equal(S.baseOf('SRK20ZSPR-S'), 'SRK20ZSPR-S');
assert.equal(S.baseOf('GMZ2-14M-W'), 'GMZ2-14M-W');
assert.equal(S.baseOf('FDE71VH'), null);
assert.equal(S.baseOf('RC-E5'), null);

// --- зіставлення: приклад власника ---
const rows = [
  { k: 'SRC35ZS-W',  n: 'SRC35ZS-W',  w: 'ODESA', p: 5,  a: 4 },
  { k: 'SRC35ZS-W1', n: 'SRC35ZS-W1', w: 'ODESA', p: 9,  a: 8 },
  { k: 'SRC35ZS-W2', n: 'SRC35ZS-W2', w: 'ODESA', p: 14, a: 12 },
  { k: 'SRC35ZS-W2', n: 'SRC35ZS-W2', w: 'KYIV_GORENICHI', p: 30, a: 20 },
  { k: 'SRC50ZS-W',  n: 'SRC50ZS-W',  w: 'ODESA', p: 1,  a: 1 },
  { k: 'SRK20ZS-W',  n: 'SRK20ZS-W',  w: 'ODESA', p: 3,  a: 2 },
  { k: 'SRK20ZS-WB', n: 'SRK20ZS-WB', w: 'ODESA', p: 1,  a: 1 },
  { k: 'FDE71VH',    n: 'FDE71VH',    w: 'ODESA', p: 2,  a: 2 },
  { k: 'FDE71VHA',   n: 'FDE71VHA',   w: 'ODESA', p: 7,  a: 7 },
];
const data = {
  warehouses: [{ code: 'ODESA', name: 'Одеса' }, { code: 'KYIV_GORENICHI', name: 'Київ — Гореничі' }],
  low_threshold: 2, fresh_minutes: 45, stale_minutes: 120,
  last_success_at: '2026-10-02T10:00:00Z', server_now: '2026-10-02T10:10:00Z', rows,
};
const idx = S.buildIndex(rows);

let v = S.matchVariants(idx, 'SRC35ZS-W2');
assert.deepEqual(v.map((x) => [x.k, x.exact]), [['SRC35ZS-W2', true], ['SRC35ZS-W', false], ['SRC35ZS-W1', false]]);
assert.equal(S.matchVariants(idx, 'SRC35ZS-W').length, 3, 'основа збігається з повною назвою');
assert.deepEqual(S.matchVariants(idx, 'SRK20ZS-WT').map((x) => x.k), ['SRK20ZS-W', 'SRK20ZS-WB'], 'кольоровий варіант бачить -W і -WB');
assert.deepEqual(S.matchVariants(idx, 'FDE71VH').map((x) => x.k), ['FDE71VH'], 'без -W/-S лише точний збіг');
assert.deepEqual(S.matchVariants(idx, 'RC-E5'), []);
assert.deepEqual(S.matchVariants(idx, ''), []);

// --- підсумки та статус ---
let sm = S.summarizeParts([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.equal(sm.parts[0].P, 58); assert.equal(sm.parts[0].A, 44); assert.equal(sm.status, 'ok');
sm = S.summarizeParts([{ m: 'SRC50ZS-W', role: 'outdoor' }], idx, data);
assert.equal(sm.status, 'low');               // вільно 1 ≤ порогу 2
sm = S.summarizeParts([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC99ZS-W', role: 'outdoor' }], idx, data);
assert.equal(sm.any, true); assert.equal(sm.status, 'out', 'одна частина відсутня → комплект «0»');
assert.equal(S.summarizeParts([{ m: 'RC-E5', role: null }], idx, data).any, false, 'нема збігів → кнопки нема');

// --- комплекти по складу ---
sm = S.summarizeParts([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
let kit = S.kitByWarehouse(sm, data);
assert.deepEqual(kit.perWh.map((x) => x.kits), [3, 0]);   // Одеса: min(2+1, 4+8+12)=3; Київ: внутр. 0
assert.equal(kit.total, 3);
assert.equal(S.kitByWarehouse(S.summarizeParts([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data), data), null);

// --- частини рядка ---
const splitList = [
  { model: 'SRK20ZT-WF',  unitType: 'indoor', splitOutdoor: 'SRС20ZT-WF' },
  { model: 'SRK20ZT-WFT', unitType: 'indoor' },
  { model: 'RC-E5', unitType: null },
];
assert.deepEqual(S.partsFor(splitList[0], 'split_mhi', splitList), [{ m: 'SRK20ZT-WF', role: 'indoor' }, { m: 'SRС20ZT-WF', role: 'outdoor' }]);
assert.deepEqual(S.partsFor(splitList[1], 'split_mhi', splitList).map((p) => p.m), ['SRK20ZT-WFT', 'SRС20ZT-WF'], 'кольоровий варіант бере зовнішній брата');
assert.deepEqual(S.partsFor(splitList[2], 'split_mhi', splitList), [{ m: 'RC-E5', role: null }]);
assert.deepEqual(S.partsFor({ model: 'SRK71ZR-W + FDC71VNX-W' }, 'semi_mhi', []).map((p) => [p.m, p.role]), [['SRK71ZR-W', 'indoor'], ['FDC71VNX-W', 'outdoor']]);
assert.deepEqual(S.partsFor({ model: 'GBZ18MLQ-W', outdoorModel: 'GCZ18MLNQ-W', unitType: 'indoor' }, 'semi_gal', []).map((p) => p.role), ['indoor', 'outdoor']);
assert.deepEqual(S.partsFor({ model: 'SCM40ZS-W', unitType: 'outdoor' }, 'multisplit_mhi', []), [{ m: 'SCM40ZS-W', role: 'outdoor' }]);

// --- свіжість ---
const t0 = Date.parse('2026-10-02T10:10:00Z');
assert.equal(S.freshness(data, t0, t0).state, 'fresh');                       // 10 хв
assert.equal(S.freshness(data, t0, t0 + 60 * 60000).state, 'aging');          // 70 хв
assert.equal(S.freshness(data, t0, t0 + 120 * 60000).state, 'stale');         // 130 хв
assert.equal(S.freshness({ ...data, last_success_at: null }, t0, t0).state, 'none');
assert.equal(S.fmtAge(0.2), 'щойно'); assert.equal(S.fmtAge(4), '4 хв тому'); assert.equal(S.fmtAge(180), '3 год тому');
assert.equal(S.fmtQty(7), '7'); assert.equal(S.fmtQty(2.5), '2,5');

// --- модель вікна ---
const sh = S.sheetModel([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.equal(sh.parts[1].variants[0].name, 'SRC35ZS-W2');
assert.deepEqual(sh.parts[1].variants[0].rows.map((r) => [r.name, r.p, r.a]), [['Одеса', 14, 12], ['Київ — Гореничі', 30, 20]]);
assert.equal(sh.kit.total, 3);

// --- реальні дані 1С + прайс ---
if (process.env.STOCK_FILE) {
  const xl = createRequire((process.env.XLSX_DIR || '.') + '/')('xlsx');
  const { parseWorkbook } = await import(pathToFileURL(path.join(repo, 'claude/edge-functions/stock-sync/parse.ts')).href);
  const { prepareRows, whKey } = await import(pathToFileURL(path.join(repo, 'claude/edge-functions/stock-sync/prepare.ts')).href);
  const WH = new Map([['Основной Киев (Гореничи) С-А', 'KYIV_GORENICHI'], ['Дополнительный Золотоноша', 'KYIV_ZOLOTONOSHA'], ['Дополнительный Малин', 'KYIV_MALYN'],
    ['Основной Одесса', 'ODESA'], ['Основной Харьков', 'KHARKIV'], ['Основной Львов', 'LVIV'], ['Основной Запорожье', 'ZAPORIZHZHIA'], ['Основной Днепр', 'DNIPRO']].map(([n, c]) => [whKey(n), c]));
  const prep = prepareRows(parseWorkbook(xl, new Uint8Array(fs.readFileSync(process.env.STOCK_FILE))), WH);
  const real = { ...data, warehouses: [...WH.values()].map((c) => ({ code: c, name: c })), rows: prep.rows };
  const ridx = S.buildIndex(real.rows);
  const a = S.summarizeParts([{ m: 'SRC35ZS-W2', role: 'outdoor' }], ridx, real);
  assert.deepEqual(a.parts[0].variants.map((x) => [x.k, x.wh && Object.values(x.wh).reduce((s, y) => s + y.a, 0)]), [['SRC35ZS-W2', 43], ['SRC35ZS-W1', 3]]);
  const b = S.summarizeParts([{ m: 'SRK20ZS-W', role: 'indoor' }], ridx, real);
  assert.deepEqual(b.parts[0].variants.map((x) => [x.k, Object.values(x.wh).reduce((s, y) => s + y.a, 0)]), [['SRK20ZS-W', 89], ['SRK20ZS-WB', 11], ['SRK20ZS-WT', 0]]);
  console.log('реальні дані 1С: OK');
}
console.log('stock.test: усе пройшло');
