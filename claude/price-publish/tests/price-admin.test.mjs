/* Тести чистої логіки price-admin.js — порівняння прайсів і вердикт.
   Запуск:  node claude/price-publish/tests/price-admin.test.mjs
   Запускати після КОЖНОЇ правки price-admin.js (те саме правило, що й для stock.js).

   DOM тут немає, тому модуль віддає лише чисті функції — так і задумано. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../../price-admin.js'), 'utf8');

const root = {};
new Function('globalThis', 'window', src).call(root, root, undefined);
const P = root.PriceAdmin;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}
function eq(a, b, what) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((what || '') + ' очікувалось ' + sb + ', отримано ' + sa);
}
function ok(v, what) { if (!v) throw new Error(what || 'очікувалось true'); }

const item = (model, price, extra) => Object.assign({ model, price }, extra || {});

console.log('\nprice-admin: чиста логіка\n');

t('статистика рахує позиції по розділах і загалом', () => {
  const s = P.statsFromSheets({ a: [item('X', 1), item('Y', 2)], b: [item('Z', 3)], notArray: 5 });
  eq(s.total, 3, 'усього');
  eq(s.sections.a, 2, 'розділ a');
  ok(!('notArray' in s.sections), 'не масив у розділи не потрапляє');
});

t('нова позиція рахується як додана', () => {
  const d = P.diffSheets({ a: [item('X', 10)] }, { a: [item('X', 10), item('Y', 20)] });
  eq(d.added, 1, 'додано'); eq(d.removed, 0, 'зникло'); eq(d.changed, 0, 'змінено');
});

t('зникла позиція рахується як видалена', () => {
  const d = P.diffSheets({ a: [item('X', 10), item('Y', 20)] }, { a: [item('X', 10)] });
  eq(d.removed, 1, 'зникло'); eq(d.added, 0, 'додано');
});

t('зміна ціни понад поріг потрапляє в помітні', () => {
  const d = P.diffSheets({ a: [item('X', 100)] }, { a: [item('X', 120)] });
  eq(d.changed, 1, 'змінено');
  eq(d.big.length, 1, 'помітних');
  eq(Math.round(d.big[0].pct), 20, 'відсоток');
});

t('дрібна зміна ціни помітною не вважається', () => {
  const d = P.diffSheets({ a: [item('X', 100)] }, { a: [item('X', 103)] });
  eq(d.changed, 1, 'змінено');
  eq(d.big.length, 0, 'помітних немає');
});

t('«за запитом» — це не нуль і не відсутня ціна', () => {
  const onReq = item('X', null, { onRequest: true });
  eq(P.priceOf(onReq), 'запит', 'за запитом');
  eq(P.priceOf(item('Y', null)), null, 'немає ціни');
  eq(P.priceOf(item('Z', 0)), 0, 'справжній нуль лишається нулем');
});

t('справжній нуль, що став ціною, видно як зміну', () => {
  const d = P.diffSheets({ a: [item('X', 0)] }, { a: [item('X', 150)] });
  eq(d.changed, 1, 'змінено');
  eq(d.big.length, 1, 'потрапило в помітні');
  eq(d.big[0].from, 0, 'було нуль');
});

t('перехід у «за запитом» потрапляє в помітні без відсотка', () => {
  const d = P.diffSheets({ a: [item('X', 100)] }, { a: [item('X', null, { onRequest: true })] });
  eq(d.changed, 1, 'змінено');
  eq(d.big[0].pct, null, 'відсотка немає');
  eq(d.big[0].to, 'запит', 'стало за запитом');
});

t('розділ, що зник цілком, фіксується окремо', () => {
  const d = P.diffSheets({ a: [item('X', 1)], b: [item('Y', 2)] }, { a: [item('X', 1)], b: [] });
  eq(d.sectionsLost, ['b'], 'зниклі розділи');
});

t('нові дублікати маркувань помічаються', () => {
  const d = P.diffSheets({}, { a: [item('X', 1), item('X', 2), item('Y', 3)] });
  eq(d.duplicates.length, 1, 'груп дублікатів');
  eq(d.duplicates[0].count, 1, 'повторів');
});

t('дублікати, що були й раніше, тривоги НЕ піднімають', () => {
  // У «Напівпромислових MHI» описи пультів законно повторюються — і так було завжди.
  const same = [item('X', 1), item('X', 2), item('Y', 3)];
  const d = P.diffSheets({ a: same }, { a: JSON.parse(JSON.stringify(same)) });
  eq(d.duplicates.length, 0, 'груп дублікатів');
});

t('той самий прайс двічі = жодної зміни', () => {
  const data = { a: [item('X', 10), item('Y', 20)], b: [item('Z', 30)] };
  const copy = JSON.parse(JSON.stringify(data));
  const d = P.diffSheets(data, copy);
  eq([d.added, d.removed, d.changed], [0, 0, 0], 'додано/зникло/змінено');
  eq(d.big.length, 0, 'помітних змін');
  const v = P.verdictFor(P.statsFromSheets(copy), d, [], P.statsFromSheets(data));
  ok(v.canPublish, 'публікувати можна');
  eq(v.warnings.length, 0, 'і жодного попередження');
});

console.log('\nprice-admin: вердикт\n');

t('порожній прайс блокує публікацію', () => {
  const stats = P.statsFromSheets({});
  const v = P.verdictFor(stats, P.diffSheets({}, {}), [], { total: 100 });
  ok(!v.canPublish, 'публікувати не можна');
  ok(v.blockers.some(b => /порожній/i.test(b)), 'сказано чому');
});

t('зниклий розділ блокує публікацію', () => {
  const prev = { a: [item('X', 1)], b: [item('Y', 2)] };
  const next = { a: [item('X', 1)], b: [] };
  const v = P.verdictFor(P.statsFromSheets(next), P.diffSheets(prev, next), [], P.statsFromSheets(prev));
  ok(!v.canPublish, 'публікувати не можна');
});

t('нерозпізнаний аркуш блокує публікацію', () => {
  const next = { a: [item('X', 1)] };
  const v = P.verdictFor(P.statsFromSheets(next), P.diffSheets({}, next), ['Спліт-системи MHI'], { total: 0 });
  ok(!v.canPublish, 'публікувати не можна');
  ok(v.blockers.some(b => /Спліт-системи MHI/.test(b)), 'названо аркуш');
});

t('масове зникнення — попередження, але не заборона', () => {
  const prev = { a: Array.from({ length: 100 }, (_, i) => item('M' + i, 10)) };
  const next = { a: Array.from({ length: 80 }, (_, i) => item('M' + i, 10)) };
  const v = P.verdictFor(P.statsFromSheets(next), P.diffSheets(prev, next), [], P.statsFromSheets(prev));
  ok(v.canPublish, 'публікувати можна');
  ok(v.warnings.some(w => /Зникло 20/.test(w)), 'попередження про 20 позицій');
});

t('звичайне оновлення цін проходить без заборон', () => {
  const prev = { a: [item('X', 100), item('Y', 200)] };
  const next = { a: [item('X', 102), item('Y', 205)] };
  const v = P.verdictFor(P.statsFromSheets(next), P.diffSheets(prev, next), [], P.statsFromSheets(prev));
  ok(v.canPublish, 'публікувати можна');
  eq(v.blockers.length, 0, 'блокерів немає');
});

console.log('\nprice-admin: версія для старих клієнтів\n');

t('версія для старих клієнтів — це дата числом', () => {
  eq(P.legacyVersionFor(new Date(2026, 9, 18)), 20261018, 'жовтень');
  eq(P.legacyVersionFor(new Date(2026, 0, 5)), 20260105, 'січень з нулями');
});

console.log('\n' + passed + ' пройдено, ' + failed + ' провалено\n');
process.exit(failed ? 1 : 0);
