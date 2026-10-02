// Тест розбору файлу 1С. Запуск (Node 22.18+/24, TS-типи стираються автоматично):
//   XLSX_DIR=<папка, де зроблено `npm i xlsx@0.18.5`> STOCK_FILE=<шлях до Выгрузка.xlsx> node parse.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseWorkbook, normKey, kyivToDate } from './parse.ts';

const require = createRequire((process.env.XLSX_DIR || '.') + '/');
const XLSX = require('xlsx');

// --- normKey ---
assert.equal(normKey('GCZ 09HM-S'), 'GCZ09HM-S');
assert.equal(normKey('MOCK35ZS-WT '), 'MOCK35ZS-WT');
assert.equal(normKey('SRС50HE-S1'), 'SRC50HE-S1', 'кирилична С → латинська C');
assert.equal(normKey('srk20zs-w'), 'SRK20ZS-W');
assert.equal(normKey(null), '');

// --- час: літо (UTC+3) і зима (UTC+2) ---
assert.equal(kyivToDate(2026, 10, 2, 13, 17, 27).toISOString(), '2026-10-02T10:17:27.000Z');
assert.equal(kyivToDate(2026, 1, 15, 13, 17, 27).toISOString(), '2026-01-15T11:17:27.000Z');

// --- реальний файл ---
const file = process.env.STOCK_FILE;
if (file) {
  const p = parseWorkbook(XLSX, new Uint8Array(fs.readFileSync(file)));
  assert.equal(p.format, 'report');
  assert.equal(p.generatedAt?.toISOString(), '2026-10-02T10:17:27.000Z');
  assert.equal(p.errors.length, 0, p.errors.join('; '));
  assert.equal(p.mismatches.length, 0, 'підсумки складів мають збігатися: ' + p.mismatches.join('; '));
  assert.equal(p.rows.length, 1127);
  const byWh = {};
  for (const r of p.rows) (byWh[r.warehouse] ??= []).push(r);
  assert.equal(Object.keys(byWh).length, Object.keys(p.headerTotals).length, 'кожен склад звіту має рядки товарів');
  const sum = (w, k) => byWh[w].reduce((s, r) => s + r[k], 0);
  assert.equal(sum('Основной Днепр', 'physical'), 574);
  assert.equal(sum('Основной Днепр', 'available'), 520);
  assert.equal(sum('Основной Киев (Гореничи) С-А', 'available'), 3627);
  assert.equal(byWh['Основной Одесса'].length, 104);
  console.log('реальний файл: OK —', p.rows.length, 'рядків,', Object.keys(byWh).length, 'складів');
}

// --- плоский формат (CSV) ---
const csv = 'Склад;Номенклатура;Всього;Вільно;Дата\nОсновной Одесса;SRK20ZS-W;5;3;2026-10-02 13:00\nОсновной Одесса;SRC20ZS-W;2,0;1;2026-10-02 13:00\n';
const f = parseWorkbook(XLSX, new TextEncoder().encode(csv));
assert.equal(f.format, 'flat');
assert.equal(f.rows.length, 2);
assert.equal(f.rows[1].physical, 2);
assert.equal(f.generatedAt?.toISOString(), '2026-10-02T10:00:00.000Z');

// --- некоректний рядок не валить розбір, а потрапляє в errors ---
const bad = 'Склад;Номенклатура;Всього;Вільно\nX;A;abc;1\nX;B;1;1\n';
const b = parseWorkbook(XLSX, new TextEncoder().encode(bad));
assert.equal(b.rows.length, 1);
assert.equal(b.errors.length, 1);

// --- файл без заголовків → помилка, а не тихий нуль ---
assert.throws(() => parseWorkbook(XLSX, new TextEncoder().encode('a;b\n1;2\n')), /заголовків/);

console.log('parse.test: усе пройшло');
