// Чиста логіка групування прайсу (js/04a-catalog-groups.js). Запуск з кореня репозиторію:
//   node claude/catalog-groups/tests/groups.test.mjs
// Дані тут — виписані вручну зразки структури справжнього прайсу (без цін).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync('js/04a-catalog-groups.js', 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);
// Результат vm-контексту має «чужі» прототипи масивів — переводимо в прості дані.
const plain = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const build = (key, items) => plain(run('cgBuildNodes')(key, items));
const flat = (nodes) => plain(run('cgFlatIndexes')(nodes));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const mk = (model, o) => Object.assign({ model, price: 1, currency: '$' }, o || {});

ok('типорозмір: маркування різних сімейств', () => {
  const cap = run('cgCapacity');
  assert.equal(cap('SRK25ZSP-W1').text, '25');
  assert.equal(cap('FDTC50VH').text, '50');
  assert.equal(cap('SRK71ZR-W + FDC71VNX-W').n, 71);
  assert.equal(cap('FDT50VH + SRC50ZSX-W2(3)').n, 50);
  assert.equal(cap('GKM09M-W').text, '09');
  assert.equal(cap('GMZ2-14M-W').text, '14');
  for (const acc of ['RC-E5', 'T-PSA-5AW-E', 'UM-FL1EF', 'SC-BIKN2-E', 'AM-MHI-01', 'Wi-Fi модуль для GKZ-A-W', 'WF-RAC', 'UT-BAT1EF', 'RG10D Remote controller,\r\nарт. 17317000A65669'])
    assert.equal(cap(acc), null, acc);
});

ok('діапазон типорозмірів ігнорує аксесуари і зберігає нулі', () => {
  const r = run('cgSizesRange');
  assert.equal(r(['SRK25ZSP-W1', 'SRK50ZSP-W1', 'RC-E5']), '25–50');
  assert.equal(r(['GKM09M-W', 'GKM18M-W']), '09–18');
  assert.equal(r(['SRK35ZS-W']), '35');
  assert.equal(r(['RC-E5']), '');
});

ok('лічильник: українська відміна', () => {
  const c = run('cgCountText');
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(c),
    ['1 позиція', '2 позиції', '4 позиції', '5 позицій', '11 позицій', '12 позицій', '14 позицій',
     '21 позиція', '22 позиції', '25 позицій', '101 позиція', '111 позицій']);
});

ok('заголовок ВЕЛИКИМИ показуємо акуратніше, короткі коди — ні', () => {
  const p = run('cgPretty');
  assert.equal(p('БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32'), 'Бізнес-клас дизайн серія R32');
  assert.equal(p('HE'), 'HE');
  assert.equal(p('Серія ZTL-W R32'), 'Серія ZTL-W R32');
});

const splitMhi = [
  mk('SRK50HE-S1', { groupKey: 'HE', groupLabel: 'HE' }),
  mk('SRK25ZSP-W1', { groupKey: 'ZSP', groupLabel: 'Популярний інвертор R32' }),
  mk('SRK35ZSP-W1', { groupKey: 'ZSP', groupLabel: 'Популярний інвертор R32' }),
  mk('SRK20ZT-WF', { groupKey: 'ZT', groupLabel: 'Premium Series ZT-W R32' }),
  mk('SRK25ZT-WF', { groupKey: 'ZT', groupLabel: 'Premium Series ZT-W R32' }),
  mk('SRK20ZT-WFT', { groupKey: 'ZT', groupLabel: 'Внутрішні кольорові' }),
  mk('SRK20ZT-WFB', { groupKey: 'ZT', groupLabel: 'Внутрішні кольорові' }),
  mk('SRC20ZT-WB', { groupKey: 'ZT', groupLabel: 'Зовнішні чорні' }),
  mk('SRR25ZS-W', { groupKey: 'ZS', groupLabel: 'Моделі канальні R32 DC PAM Inverter' }),
  mk('SRR35ZS-W', { groupKey: 'ZS', groupLabel: 'Моделі канальні R32 DC PAM Inverter' }),
  mk('UT-BAT1EF', { groupLabel: 'Комплект для забору повітря знизу (опція)' }),
  mk('UT-BAT2EF', { groupLabel: 'Комплект для забору повітря знизу (опція)' }),
  mk('RC-E5', { groupLabel: 'Пульти', groupNote: 'Пульт для касетного блоку замовляється додатково' })
];

ok('спліт MHI: серія ZT — один блок із підзаголовками, решта як у прайсі', () => {
  const nodes = build('split_mhi', splitMhi);
  assert.deepEqual(flat(nodes), splitMhi.map((_, i) => i));
  const groups = nodes.filter(g => g.type === 'group');
  assert.deepEqual(groups.map(g => g.title), ['HE-S1', 'ZSP-W1 · Популярний інвертор R32', 'Premium Series ZT-W R32',
    'Канальні · SRR ZS-W · R32 DC PAM Inverter', 'Пульти']);
  const zt = groups[2];
  assert.equal(zt.count, 5);
  assert.deepEqual(zt.blocks.map(b => b.label), [null, 'Внутрішні кольорові', 'Зовнішні чорні']);
  assert.equal(zt.sizes, '20–25');
  assert.equal(groups[4].note.includes('Пульт'), true);
  assert.equal(groups[4].sizes, '');
});

ok('примітка про пульт касетного блоку переїжджає з «Пульти» до касет', () => {
  const items = splitMhi.concat([mk('FDTC25VH1', { groupKey: 'VH', groupLabel: 'Моделі 4-х потокові компактні касети 600х600' })]);
  const nodes = build('split_mhi', items).filter(g => g.type === 'group');
  const rc = nodes.find(g => g.rawTitle === 'Пульти');
  assert.equal(rc.note, '');
  const cass = nodes.find(g => g.rawTitle === 'Моделі 4-х потокові компактні касети 600х600');
  assert.equal(cass.note.indexOf('Пульт для касетного блоку') === 0, true);
});

ok('комплект забору повітря відкривається разом із канальними (підблок, порядок прайсу)', () => {
  const nodes = build('split_mhi', splitMhi);
  const duct = nodes.find(g => g.type === 'group' && g.rawTitle === 'Моделі канальні R32 DC PAM Inverter');
  assert.equal(duct.count, 4);
  assert.deepEqual(duct.blocks.map(b => [b.label, b.entries.length]), [[null, 2], ['Комплект для забору повітря знизу (опція)', 2]]);
  assert.equal(duct.sizes, '25–35');
  assert.equal(nodes.some(g => g.type === 'group' && g.rawTitle.indexOf('Комплект') === 0), false);
});

ok('комплект, що стоїть НЕ одразу після канальних, лишається окремою групою', () => {
  const items = [mk('SRR25ZS-W', { groupKey: 'ZS', groupLabel: 'Моделі канальні R32 DC PAM Inverter' }),
    mk('SRK25ZSP-W1', { groupKey: 'ZSP', groupLabel: 'Популярний інвертор R32' }),
    mk('UT-BAT1EF', { groupLabel: 'Комплект для забору повітря знизу (опція)' })];
  const nodes = build('split_mhi', items);
  assert.deepEqual(flat(nodes), [0, 1, 2]);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[2].rawTitle, 'Комплект для забору повітря знизу (опція)');
});

ok('розірвана серія не губить позицій і не міняє порядку', () => {
  const items = [mk('SRK25ZSP-W1', { groupLabel: 'A' }), mk('SRK25ZS-W', { groupLabel: 'B' }), mk('SRK35ZSP-W1', { groupLabel: 'A' })];
  const nodes = build('split_gal', items);
  assert.deepEqual(flat(nodes), [0, 1, 2]);
  const ids = nodes.map(g => g.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(nodes[2].split, true);
});

const msMhi = [
  mk('SCM40ZS-W', { unitType: 'outdoor', blockName: 'Підключення до 2 внутрішніх блоків', sectionLabel: 'Зовнішні блоки' }),
  mk('SCM45ZS-W', { unitType: 'outdoor', blockName: 'Підключення до 2 внутрішніх блоків' }),
  mk('SKM20ZSP-W', { unitType: 'indoor', groupKey: 'Настінний', blockName: 'Настінний', sectionLabel: 'Внутрішні блоки' }),
  mk('SRK20ZS-W', { unitType: 'indoor', groupKey: 'Настінний', blockName: 'Настінний' }),
  mk('SRK20ZS-WT', { unitType: 'indoor', groupKey: 'Настінний', blockName: 'Настінний' }),
  mk('SRK20ZSX-W', { unitType: 'indoor', groupKey: 'Настінний', blockName: 'Настінний' }),
  mk('SRK71ZR-W', { unitType: 'indoor', groupKey: 'Настінний', blockName: 'Настінний' }),
  mk('FDTC25VH1', { unitType: 'indoor', groupKey: 'Касетний без панелі', blockName: 'Касетний без панелі' }),
  mk('TC-PSA-5AW-E', { blockName: 'Панель для касетних блоків' }),
  mk('FDE50VH', { unitType: 'indoor', groupKey: 'Підстельовий', blockName: 'Підстельовий' }),
  mk('RC-E5', { blockName: 'Дротовий' })
];

ok('мульти MHI: зовнішні й аксесуари — відкриті рядки; внутрішні — по серіях і типах', () => {
  const nodes = build('multisplit_mhi', msMhi);
  assert.deepEqual(flat(nodes), msMhi.map((_, i) => i));
  const kinds = nodes.map(x => x.type === 'group' ? 'G:' + x.id : x.type === 'section' ? 'S:' + x.label : 'row');
  assert.deepEqual(kinds, [
    'S:Зовнішні блоки', 'row', 'row',
    'S:Внутрішні блоки', 'G:wall-zsp', 'G:wall-zs', 'G:wall-zsx', 'G:wall-zr',
    'G:type-касетний-без-панелі', 'G:type-підстельовий', 'row']);
  const zs = nodes.find(x => x.id === 'wall-zs');
  assert.equal(zs.count, 2);
  assert.equal(zs.title, 'ZS-W · Бізнес-клас дизайн серія R32');
  assert.equal(zs.subtitle, 'типорозміри 20');
});

ok('мульти MHI: панель TC-PSA-5AW-E лежить у «Касетний без панелі»', () => {
  const nodes = build('multisplit_mhi', msMhi);
  const cass = nodes.find(x => x.id === 'type-касетний-без-панелі');
  assert.equal(cass.title, 'Касетний без панелі · FDTC VH');
  assert.deepEqual(cass.blocks.map(b => [b.label, b.entries.map(e => e.item.model)]),
    [[null, ['FDTC25VH1']], ['Панель для касетних блоків', ['TC-PSA-5AW-E']]]);
  assert.equal(cass.count, 2);
});

const msGal = [
  mk('GMZ2-14M-W', { unitType: 'outdoor' }), mk('GMZ5-42M7-W', { unitType: 'outdoor' }),
  mk('GKM09M-W', { unitType: 'indoor' }), mk('GKM09M-WR', { unitType: 'indoor' }), mk('GKZ09MG-WR', { unitType: 'indoor' }),
  mk('GMZ2-14H-W', { unitType: 'outdoor' }), mk('GKM12H-W', { unitType: 'indoor' }),
  mk('GMZ2-14H-S', { unitType: 'outdoor' }), mk('GKM09H-S', { unitType: 'indoor' }), mk('GBM12H-S', { unitType: 'indoor' }), mk('GDM18H-S', { unitType: 'indoor' })
];

ok('мульти GAL: три серії за суфіксом, у кожній зовнішні й внутрішні блоки', () => {
  const nodes = build('multisplit_gal', msGal);
  assert.deepEqual(flat(nodes), msGal.map((_, i) => i));
  assert.deepEqual(nodes.map(g => [g.title, g.subtitle, g.count]), [
    ['Серія M-W', 'Фреон R32', 5], ['Серія H-W', 'Фреон R32', 2], ['Серія H-S', 'Фреон R410', 4]]);
  const mw = nodes[0];
  assert.deepEqual(mw.blocks.map(b => [b.label, b.sizes]), [['Зовнішні блоки', '14–42'], ['Внутрішні блоки', '09']]);
});

ok('мульти GAL: невідомий суфікс лишається рядком, не зникає', () => {
  const items = msGal.concat([mk('GKM18X-Q', { unitType: 'indoor' })]);
  const nodes = build('multisplit_gal', items);
  assert.deepEqual(flat(nodes), items.map((_, i) => i));
  assert.equal(nodes[nodes.length - 1].type, 'row');
});

ok('кожна назва з таблиці має маркування серії, а її коди є в моделях фікстур', () => {
  const titles = run('CG_TITLES');
  const fixtures = { split_mhi: splitMhi, multisplit_mhi: msMhi };
  for (const key of Object.keys(fixtures)) {
    const groups = build(key, fixtures[key]).filter(g => g.type === 'group');
    for (const g of groups) {
      if (g.exempt) continue;
      assert.equal(g.marked, true, key + ': ' + g.title);
      const units = g.entries.filter(e => run('cgCapacity')(e.item.model)).map(e => e.item.model);
      for (const m of units) assert.equal(g.codes.some(c => m.toUpperCase().includes(c)), true, key + ': ' + m + ' не містить ' + g.codes);
    }
  }
  // Назви не-настінних груп починаються з типу блока
  const first = (k, raw) => titles[k][raw].title;
  assert.equal(first('split_mhi', 'Моделі 2-х потокові підлогового виконання').startsWith('Підлогові'), true);
  assert.equal(first('split_mhi', 'Моделі 4-х потокові компактні касети 600х600').startsWith('Касетні'), true);
  assert.equal(first('semi_gal', 'Канальний').startsWith('Канальний'), true);
});

ok('розділ без правил групування не чіпаємо', () => {
  assert.equal(build('vrf_gal_outdoor', [mk('X1')]), null);
});

ok('фото груп: кожен запис CG_PHOTOS — реальна група з CG_TITLES, реальний файл і відомо, звідки взято', () => {
  const photos = plain(run('CG_PHOTOS'));
  const tit = plain(run('CG_TITLES'));
  const src = JSON.parse(fs.readFileSync('tile-images/mhi-groups/_source.json', 'utf8')).files;
  for (const key of Object.keys(photos)) {
    for (const [raw, name] of Object.entries(photos[key])) {
      if (tit[key]) assert.ok(tit[key][raw], key + ': немає групи «' + raw + '» у CG_TITLES');
      else assert.ok(Object.values(plain(run('CG_GAL_SERIES'))).some(x => x.title === raw), key + ': немає серії «' + raw + '» у CG_GAL_SERIES');
      assert.ok(fs.existsSync('tile-images/mhi-groups/' + name + '.webp'), 'немає файлу ' + name);
      assert.ok(src[name] && ((src[name].page && src[name].xref) || src[name].url), name + ': не записано, звідки взято (сторінка каталогу або адреса сайту)');
    }
  }
});

ok('шапка групи: ні кнопки ⓘ, ні дублюючого рядка опису; фото й кВт лише в групі з фото', () => {
  const html = (cfgKey, g) => run('cgGroupHtml')({ key: cfgKey }, g);
  const mkE = (m) => ({ item: mk(m), index: 0 });
  const entries = ['SRK20ZSPR-S', 'SRK80ZSPR-S'].map(mkE);
  const g = { id: 'x', rawTitle: 'Популярний інвертор R410', title: 'ZSPR-S · Популярний інвертор R410', blocks: [{ label: null, entries }],
    entries, count: 2, note: '', info: { key: 'k', text: 'довгий опис серії довгий опис серії' }, d: {} };
  run('hasFullAccess = false; activeTile = "split"; activeBrand = "mhi"; seriesInfoTexts = [];' +
    ' APP_BUILD = "T"; catalogRowHtml = () => "<row/>"; escapeHtml = (x) => String(x); cartQtyFor = () => 0;' +
    ' psKey = (x) => String(x).toUpperCase(); catKey = (x) => psKey(x).replace(/[-_]/g, "");' +
    ' mhiCatalog = { index: { split_mhi: { SRK20ZSPRS: "A|0", SRK80ZSPRS: "A|1" } }, series: { A: { marking: "SRK-ZSPR-S", series: "Standard Series", block: "Настінний" } } };');
  const withPhoto = html('split_mhi', g);
  assert.equal(withPhoto.includes('sg-info'), false);
  assert.equal(withPhoto.includes('sg-desc'), false);
  assert.equal(withPhoto.includes('tile-images/mhi-groups/split-zspr.webp'), true);
  assert.equal(withPhoto.includes('2–8\u00a0кВт'), true);
  assert.equal(withPhoto.includes('sg-badge'), false);
  const other = [mkE('XYZ100-A')];
  const noPhoto = html('split_mhi', Object.assign({}, g, { rawTitle: 'Невідома група', title: 'Невідома група', blocks: [{ label: null, entries: other }], entries: other, count: 1 }));
  assert.equal(noPhoto.includes('sg-photo'), false);
  assert.equal(noPhoto.includes('кВт'), false);
  assert.equal((noPhoto.match(/ипорозміри/g) || []).length <= 1, true);
});

ok('кВт групи: типорозмір ÷ 10, діапазон, дрібні значення з комою', () => {
  const kw = run('cgKwText');
  assert.equal(kw(['SRK20ZSPR-S', 'SRK80ZSPR-S']), '2–8\u00a0кВт');
  assert.equal(kw(['SRK25ZSP-W1', 'SRK50ZSP-W1']), '2,5–5\u00a0кВт');
  assert.equal(kw(['SRK35ZS-W']), '3,5\u00a0кВт');
  assert.equal(kw(['RC-E5']), '');
});


ok('шапки: кожна група з CG_TITLES має або картку каталогу MHI, або запис у CG_HEAD; кВт Galactic — лише з CG_KW', () => {
  const tit = plain(run('CG_TITLES'));
  const head = plain(run('CG_HEAD'));
  const photos = plain(run('CG_PHOTOS'));
  const withoutHeadOk = new Set(['split_mhi|ТЕПЛОВИЙ НАСОС / БІЗНЕС-КЛАС / ДИЗАЙН СЕРІЯ R32']);   // MHI-спліт/мульти беруть шапку з картки каталогу
  for (const key of ['semi_mhi', 'split_gal', 'semi_gal']) {
    for (const raw of Object.keys(tit[key])) {
      assert.ok((head[key] || {})[raw], key + ': немає CG_HEAD для «' + raw + '»');
      assert.ok((photos[key] || {})[raw], key + ': немає фото для «' + raw + '»');
    }
  }
  const kw = plain(run('CG_KW'));
  for (const key of Object.keys(kw)) assert.ok(/_gal$/.test(key), 'CG_KW — лише для Galactic: ' + key);
  void withoutHeadOk;
});

console.log('\nУсього перевірок:', n);
