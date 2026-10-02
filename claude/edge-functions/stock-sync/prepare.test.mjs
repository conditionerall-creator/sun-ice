// Тест підготовки рядків. Запуск: XLSX_DIR=<папка з xlsx> STOCK_FILE=<Выгрузка.xlsx> node prepare.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseWorkbook } from './parse.ts';
import { prepareRows, hashRows, whKey } from './prepare.ts';

const require = createRequire((process.env.XLSX_DIR || '.') + '/');
const XLSX = require('xlsx');

const WH = new Map([
  ['Основной Киев (Гореничи) С-А', 'KYIV_GORENICHI'], ['Дополнительный Золотоноша', 'KYIV_ZOLOTONOSHA'],
  ['Дополнительный Малин', 'KYIV_MALYN'], ['Основной Одесса', 'ODESA'], ['Основной Харьков', 'KHARKIV'],
  ['Основной Львов', 'LVIV'], ['Основной Запорожье', 'ZAPORIZHZHIA'], ['Основной Днепр', 'DNIPRO'],
].map(([n, c]) => [whKey(n), c]));

// --- синтетика: клампи, злиття, відсів ---
const fake = { format: 'flat', generatedAt: new Date(), headerTotals: {}, mismatches: [], warnings: [], errors: [],
  rows: [
    { warehouse: ' основной  одесса ', item: 'GCZ 09HM-S', physical: 3, available: 2 },
    { warehouse: 'Основной Одесса', item: 'GCZ09HM-S', physical: 1, available: 1 },   // той самий ключ → злиття
    { warehouse: 'Основной Одесса', item: 'X', physical: -4, available: -1 },        // від'ємні → 0
    { warehouse: 'Основной Одесса', item: 'Y', physical: 2, available: 5 },          // вільно > всього
    { warehouse: 'Неліквід Дніпро', item: 'Z', physical: 9, available: 9 },          // чужий склад
    { warehouse: 'Основной Одесса', item: '   ', physical: 1, available: 1 },        // порожня назва
  ] };
const f = prepareRows(fake, WH);
assert.equal(f.rows.length, 3);
assert.equal(f.merged, 1);
assert.equal(f.clamped, 2);
assert.equal(f.ignored, 1);
assert.equal(f.errors, 1);
const m = f.rows.find((r) => r.k === 'GCZ09HM-S');
assert.deepEqual([m.p, m.a, m.n], [4, 3, 'GCZ 09HM-S']);
assert.deepEqual(f.rows.find((r) => r.k === 'X'), { w: 'ODESA', k: 'X', n: 'X', p: 0, a: 0 });
assert.deepEqual(f.rows.find((r) => r.k === 'Y'), { w: 'ODESA', k: 'Y', n: 'Y', p: 2, a: 2 });

// --- хеш не залежить від порядку рядків ---
const h1 = await hashRows(f.rows);
const h2 = await hashRows([...f.rows].reverse());
assert.equal(h1, h2);
assert.notEqual(h1, await hashRows(f.rows.slice(1)));

// --- реальний файл ---
if (process.env.STOCK_FILE) {
  const parsed = parseWorkbook(XLSX, new Uint8Array(fs.readFileSync(process.env.STOCK_FILE)));
  const p = prepareRows(parsed, WH);
  const sum = (w, k) => p.rows.filter((r) => r.w === w).reduce((s, r) => s + r[k], 0);
  console.log('реальний файл: прийнято', p.rows.length, 'ігноровано', p.ignored, 'помилок', p.errors, 'виправлено', p.clamped, 'злито', p.merged);
  console.log('ігноровані склади:', p.ignoredWarehouses.join(' | '));
  assert.equal(p.received, 1127);
  assert.equal(p.rows.length + p.ignored + p.errors + p.merged, 1127);
  assert.equal(p.errors, 0);
  assert.equal(sum('DNIPRO', 'p'), 574);
  assert.equal(sum('DNIPRO', 'a'), 520);
  assert.equal(sum('KYIV_GORENICHI', 'a'), 3627);
  assert.equal(sum('ODESA', 'a'), 767);
  assert.ok(await hashRows(p.rows));
}
console.log('prepare.test: усе пройшло');
