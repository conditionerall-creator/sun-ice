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

// --- КОРОТКА панель: з 2026-10-16 ТІЛЬКИ ТОЧНИЙ ЗБІГ (схожі позиції — у повній інформації) ---
let cv = S.compactView([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.deepEqual(cv.rows.map((r) => [r.name, r.vals[0].p, r.vals[0].a]), [['Одеса', 14, 12], ['Київ — Гореничі', 30, 20]], 'лише точний збіг: -W і -W1 сюди не входять');
assert.equal(cv.hasExact, true);
assert.deepEqual(cv.totals, [{ p: 44, a: 32 }], 'підсумок основних складів — теж лише точний збіг');
assert.equal(cv.extra.any, true); assert.deepEqual(cv.extra.vals, [{ p: 3, a: 3 }]);
assert.equal(cv.similar, 2, 'схожі не зникли — їх рахуємо, щоб написати «є ще N»');
cv = S.compactView([{ m: 'SRK20ZS-WT', role: null }], idx, data);
assert.equal(cv.hasExact, false, 'точного збігу немає (є лише -W і -WB) → панель так і каже');
assert.equal(cv.rows.length, 0);
cv = S.compactView([{ m: 'ONLYUSED-W', role: null }], idx, data);
assert.equal(cv.rows.length, 0, 'на основних нема — рядків нема'); assert.equal(cv.extra.any, true);
cv = S.compactView([{ m: 'ZEROMAIN-W', role: null }], idx, data);
assert.equal(cv.rows.length, 0, 'склад з нулем у короткій панелі не показується');
cv = S.compactView([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }], idx, data);
assert.deepEqual(cv.rows.map((r) => [r.name, r.vals.map((x) => x.a)]), [['Одеса', [2, 12]], ['Київ — Гореничі', [0, 20]]]);

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

// --- ПОЗНАЧКА В РЯДКУ ПРАЙСУ (рішення власника 2026-10-16) ---
// Дилер з Одеси: сервер віддає лише одеські рядки + перелік маркувань, доступних деінде.
const userRows = rows.filter((r) => r.w === 'ODESA').concat([{ k: 'RESERVED-W', n: 'RESERVED-W', w: 'ODESA', p: 8, a: 3 }]);
const userData = {
  mode: 'user', region_id: 2, badge_threshold: 5, low_threshold: 2, fresh_minutes: 45, stale_minutes: 120,
  last_success_at: '2026-10-02T10:00:00Z', server_now: '2026-10-02T10:10:00Z',
  warehouses: [{ code: 'ODESA', name: 'Одеса', kind: 'main', region: 'Одеса', region_id: 2 }],
  rows: userRows, elsewhere: ['ZEROMAIN-W', 'FARAWAY-W'],
};
const uidx = S.buildIndex(userRows);
const badge = (m) => S.badgeFor([].concat(m).map((x) => (typeof x === 'string' ? { m: x, role: null } : x)), uidx, userData);

let b = badge('SRC35ZS-W2');                       // 14 всього / 12 вільних
assert.deepEqual([b.label, b.tone, b.note], ['>5', 'ok', null], 'підпис без «шт.» — рішення власника');
b = badge('SRK20ZS-W');                            // 3 / 2
assert.deepEqual([b.label, b.tone, b.note], ['<5', 'ok', null]);
b = badge('RESERVED-W');                           // 8 всього, вільних 3 → цифра від загального, колір від вільного
assert.deepEqual([b.label, b.tone, b.note], ['>5', 'warn', 'reserved'], 'приклад власника: 80 на складі / 3 вільних');
b = badge('ZEROMAIN-W');                           // 0 у регіоні, але є деінде
assert.deepEqual([b.label, b.tone, b.note], ['0', 'warn', 'elsewhere']);
b = badge('FARAWAY-W');                            // у регіоні немає зовсім, але є деінде
assert.deepEqual([b.label, b.tone, b.note], ['0', 'warn', 'elsewhere'], 'позиції, якої немає в регіоні, у rows немає — беремо з elsewhere');
b = badge('FDE71VH');                              // 2 / 2 у регіоні, деінде немає
assert.deepEqual([b.label, b.tone], ['<5', 'ok']);
assert.equal(badge('NOPE-W'), null, 'немає ні в регіоні, ні деінде → позначки немає взагалі');
// комплект: беремо min(внутр., зовн.) по складу
b = badge([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'SRC35ZS-W2', role: 'outdoor' }]);
assert.deepEqual([b.label, b.tone], ['<5', 'ok'], 'min(3,14) всього і min(2,12) вільних');
assert.equal(badge([{ m: 'SRK20ZS-W', role: 'indoor' }, { m: 'NOPE-W', role: 'outdoor' }]), null, 'півкомплекту — це не наявність');
// червоний нуль: позиція є в 1С регіону з нулем і ніде більше
const redRows = userRows.concat([{ k: 'NOWHERE-W', n: 'NOWHERE-W', w: 'ODESA', p: 0, a: 0 }]);
const redData = { ...userData, rows: redRows };
b = S.badgeFor([{ m: 'NOWHERE-W', role: null }], S.buildIndex(redRows), redData);
assert.deepEqual([b.label, b.tone, b.note], ['0', 'out', 'nowhere']);
// підписи під позначкою
assert.ok(S.badgeNote({ note: 'elsewhere', region: 'Одеса' }).includes('Одеса'));
assert.ok(S.badgeNote({ note: 'nowhere' }).includes('жодному складі'));
assert.equal(S.badgeNote({ note: null }), '');
// адмін: позначка рахується по СВОЄМУ регіону, решта складів у неї не входить
const adminData = { ...data, mode: 'admin', region_id: 2, badge_threshold: 5, elsewhere: [],
  warehouses: data.warehouses.map((w) => ({ ...w, region_id: w.region === 'Одеса' ? 2 : 1 })) };
b = S.badgeFor([{ m: 'SRC35ZS-W2', role: 'outdoor' }], idx, adminData);
assert.deepEqual([b.label, b.tone, b.region], ['>5', 'ok', 'Одеса'], 'київські 30 шт. у позначку одеського адміна не потрапляють');
assert.equal(S.regionWarehouses({ ...adminData, region_id: null }).length, 0, 'адмін без регіону — позначки немає');

// --- СКЛЕЄНІ НАЗВИ 1С «A/B» (знайдено власником 2026-10-16) ---
// У 1С частина комплектів заведена одним рядком: «SRK50HE-S1/SRC50HE-S1». Раніше такий рядок
// не збігався з жодним маркуванням прайсу, і дилер бачив «0» на товар, якого 14 штук.
const pairRows = [
  { k: 'SRK50HE-S1', n: 'SRK50HE-S1', w: 'KYIV_GORENICHI', p: 1, a: 1 },
  { k: 'SRK50HE-S1/SRC50HE-S1', n: 'SRK50HE-S1/SRC50HE-S1', w: 'KYIV_GORENICHI', p: 14, a: 11 },
];
const pidx = S.buildIndex(pairRows);
assert.equal(pidx.byKey.get('SRK50HE-S1/SRC50HE-S1'), undefined, 'склеєний ключ в індексі не лишається — інакше подвійний рахунок');
assert.deepEqual(pidx.byKey.get('SRK50HE-S1').wh.KYIV_GORENICHI, { p: 15, a: 12 }, 'внутрішній: 1 окремо + 14 у комплектах');
assert.deepEqual(pidx.byKey.get('SRC50HE-S1').wh.KYIV_GORENICHI, { p: 14, a: 11 }, 'зовнішній існує лише всередині комплекту');
assert.deepEqual(pidx.byKey.get('SRC50HE-S1').from, ['SRK50HE-S1/SRC50HE-S1'], 'звідки взялись числа — видно адміну');

const kyivAdmin = {
  mode: 'admin', region_id: 1, badge_threshold: 5, low_threshold: 2, fresh_minutes: 45, stale_minutes: 120,
  last_success_at: '2026-10-16T09:00:00Z', server_now: '2026-10-16T09:05:00Z',
  warehouses: [{ code: 'KYIV_GORENICHI', name: 'Гореничі', kind: 'main', region: 'Київ', region_id: 1 },
               { code: 'ODESA', name: 'Одеса', kind: 'main', region: 'Одеса', region_id: 2 }],
  rows: pairRows, elsewhere: [],
};
let pb = S.badgeFor([{ m: 'SRK50HE-S1', role: 'indoor' }, { m: 'SRC50HE-S1', role: 'outdoor' }], pidx, kyivAdmin);
assert.deepEqual([pb.label, pb.tone], ['>5', 'ok'], 'комплект зі склеєного рядка: min(15,14) всього, min(12,11) вільних');

// --- АДМІН: «є на інших складах» рахує клієнт (сервер віддає адміну порожній elsewhere) ---
// Без цього будь-який нуль у своєму регіоні ставав червоним «немає ніде» (знайдено власником).
const adminRows = [
  { k: 'ONLYKYIV-W', n: 'ONLYKYIV-W', w: 'KYIV_GORENICHI', p: 4, a: 0 }, // є, але все зарезервовано
  { k: 'NOWHERE2-W', n: 'NOWHERE2-W', w: 'ODESA', p: 0, a: 0 },
];
const odesaAdmin = { ...kyivAdmin, region_id: 2, rows: adminRows };
const aidx = S.buildIndex(adminRows);
let ab = S.badgeFor([{ m: 'ONLYKYIV-W', role: null }], aidx, odesaAdmin);
assert.deepEqual([ab.label, ab.tone, ab.note], ['0', 'warn', 'elsewhere'], '4 шт. у Києві, хай і в резерві, — це не «немає ніде»');
ab = S.badgeFor([{ m: 'NOWHERE2-W', role: null }], aidx, odesaAdmin);
assert.deepEqual([ab.label, ab.tone, ab.note], ['0', 'out', 'nowhere'], 'ніде нічого — ось тоді червоний');
assert.ok(S.elsewhereSet(odesaAdmin, [{ code: 'ODESA' }])['ONLYKYIV-W'], 'ключ потрапив у множину «деінде»');

// Комплект: внутрішній лежить у МЕНЕ, але весь у резерві; зовнішній треба везти з іншого складу.
// Такий комплект НЕ «немає ніде» — внутрішній блок фізично тут (виправлено після перепису каталогу).
const kitRows = [
  { k: 'INHERE-W', n: 'INHERE-W', w: 'ODESA', p: 3, a: 0 },          // у мене є, але зарезервовано
  { k: 'OUTFAR-W', n: 'OUTFAR-W', w: 'KYIV_GORENICHI', p: 2, a: 2 }, // лише в Києві
];
const kidx = S.buildIndex(kitRows);
const kdata = { ...odesaAdmin, rows: kitRows };
let kb = S.badgeFor([{ m: 'INHERE-W', role: 'indoor' }, { m: 'OUTFAR-W', role: 'outdoor' }], kidx, kdata);
assert.deepEqual([kb.label, kb.tone, kb.note], ['0', 'warn', 'elsewhere'], 'половина комплекту в мене на складі — це не «немає ніде»');
assert.ok(S.elsewhereSet({ mode: 'user', elsewhere: ['A-W/B-W'] }, [])['B-W'], 'склеєний ключ із серверного списку теж розкладається');

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
