/* Sun-ice — панель товару (П-9 … П-12)
   Частина переробки інтерфейсу 2026-10-08/09. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна.

   Панель відкривається дотиком по ПОРОЖНЬОМУ місцю рядка прайсу; дотик по самому
   маркуванню веде на картку sun-ice.com.ua.

   Головне правило цього файлу (рішення власника 2026-10-09): увесь функціонал кнопок
   живе ТУТ, усередині панелі. Раніше кнопки лише натискали сховані елементи рядка —
   це був тимчасовий місток, тепер його немає. Виняток один: повна таблиця наявності
   (Stock.openSheet) — це готовий екран stock.js, дублювати його було б гірше. */

/* Характеристики: data/specs-<розділ>.json, готує claude/site-catalog/build_specs.py
   (сайт не віддає CORS). Вантажимо лише при першому відкритті панелі в розділі.
   Версію НЕ пишемо руками — беремо APP_BUILD, який піднімає set-build.py. */
const SPECS_FILES = {
  split_mhi:      'data/specs-split-mhi.json',
  split_gal:      'data/specs-split-gal.json',
  multisplit_mhi: 'data/specs-multisplit-mhi.json',
  multisplit_gal: 'data/specs-multisplit-gal.json',
  semi_mhi:       'data/specs-semi-mhi.json',
  semi_gal:       'data/specs-semi-gal.json'
};
const specsCache = {};
const specsLoading = {};

function loadSpecs(cfgKey) {
  if (specsCache[cfgKey]) return Promise.resolve(specsCache[cfgKey]);
  if (!SPECS_FILES[cfgKey]) return Promise.resolve(null);
  if (specsLoading[cfgKey]) return specsLoading[cfgKey];
  specsLoading[cfgKey] = fetch(SPECS_FILES[cfgKey] + '?v=' + APP_BUILD)
    .then(r => r.ok ? r.json() : null)
    .then(j => { specsCache[cfgKey] = (j && j.specs) || {}; return specsCache[cfgKey]; })
    .catch(() => { specsCache[cfgKey] = {}; return specsCache[cfgKey]; });
  return specsLoading[cfgKey];
}

/* Стан відкритої панелі. Скидається при кожному відкритті — калькулятор не повинен
   «пам'ятати» націнку з попереднього товару, це була б тиха пастка. */
let psState = null;

/* ---------- Характеристики ---------- */

/* «Головні шість» мусять відрізнятись за типом блока: у настінного важить шум, у
   канального — напір, у зовнішнього блока мультиспліту немає ні площі, ні класу.
   Спершу йдемо за пріоритетним списком; якщо набралось менше шести — доповнюємо
   першими рядками таблиці «Основні» в тому порядку, як їх подає сайт (він сам ставить
   головне першим), пропускаючи завідомо непотрібне. */
const SPEC_PRIORITY_DEFAULT = [
  'Холодопродуктивн', 'Теплопродуктивн', 'Рекомендована площа',
  'Клас енергоефективності охолодження', 'Внутрішній блок, охолодження',
  'Максимальна кількість внутрішніх блоків', 'Максимальна довжина магістралі',
  'Статичний тиск', 'Розмір внутрішнього блоку', 'Розмір зовнішнього блоку', 'Тип фреону'
];
const SPEC_SKIP_IN_KEY = ['Гарантія', 'Країна виробник', 'Модель внутрішнього блоку',
  'Модель зовнішнього блоку', 'Серія', 'Повітряний фільтр'];

function pickKeySpecs(spec) {
  const flat = [];
  (spec['основні'] || []).forEach(g => g.rows.forEach(r => flat.push(r)));
  const out = [];
  SPEC_PRIORITY_DEFAULT.forEach(pat => {
    if (out.length >= 6) return;
    const hit = flat.find(r => r[0].indexOf(pat) === 0 && out.indexOf(r) < 0);
    if (hit) out.push(hit);
  });
  if (out.length < 6) {
    flat.forEach(r => {
      if (out.length >= 6 || out.indexOf(r) >= 0) return;
      if (SPEC_SKIP_IN_KEY.some(s => r[0].indexOf(s) === 0)) return;
      out.push(r);
    });
  }
  return out;
}

function specsTotalCount(spec) {
  let n = 0;
  ['основні', 'додаткові'].forEach(p => (spec[p] || []).forEach(g => { n += g.rows.length; }));
  return n;
}

/* Рядок характеристики. Назва й значення в одній таблиці із «зеброю»: до 2026-10-09
   вони були розтягнуті по краях екрана (назва ліворуч, значення праворуч), і на 56
   рядках око губило, яке значення до якої назви належить. */
function specRowsHtml(rows) {
  return rows.map(function (r) {
    return '<div class="ps-spec-row"><span class="ps-spec-name">' + escapeHtml(r[0]) +
           '</span><span class="ps-spec-val">' + escapeHtml(r[1]) + '</span></div>';
  }).join('');
}

function specsHtml(spec) {
  if (!spec) return '<div class="ps-empty">Для цієї моделі характеристик на сайті не знайшлось.</div>';
  const key = pickKeySpecs(spec);
  const total = specsTotalCount(spec);
  const groups = [];
  ['основні', 'додаткові'].forEach(function (part) {
    (spec[part] || []).forEach(function (g) {
      if (!g.rows.length) return;
      const label = g.g || (part === 'основні' ? 'Основні характеристики' : 'Додаткові характеристики');
      groups.push(
        '<details class="ps-group"><summary><span>' + escapeHtml(label) +
        '</span><span class="ps-group-n">' + g.rows.length + '</span></summary>' +
        '<div class="ps-spec-table">' + specRowsHtml(g.rows) + '</div></details>');
    });
  });
  return '<div class="ps-block-title">Головне</div>' +
         '<div class="ps-spec-table">' + specRowsHtml(key) + '</div>' +
         '<details class="ps-all"><summary><span>Усі характеристики</span>' +
         '<span class="ps-group-n">' + total + '</span></summary>' +
         '<div class="ps-all-body">' + groups.join('') + '</div></details>';
}

/* ---------- Калькулятор ---------- */

/* Чому не чотири кнопки «−% +% −сума +сума», як було в рядку: для людини, що бачить це
   вперше, вони нічого не означають. Розкладаємо на два зрозумілі вибори — ЩО робимо
   (націнка чи знижка) і ЧИМ (відсотком чи сумою). Математика лишилась та сама.
   Умовчання «Націнка»: у прайсі показана ДИЛЕРСЬКА ціна, і типова дія дилера — додати
   свій заробіток, а не відняти від власної закупки. */
function calcUnit() {
  const s = psState;
  const base = convertAmount(s.price, s.nativeCur, s.cur, usdRate);
  const v = (isNaN(s.value) || s.value < 0) ? 0 : s.value;
  let r;
  if (s.dir === 'add') r = s.kind === 'pct' ? base * (1 + v / 100) : base + v;
  else                 r = s.kind === 'pct' ? base * (1 - v / 100) : base - v;
  return r < 0 ? 0 : r;
}

function calcHtml() {
  const s = psState;
  const base = convertAmount(s.price, s.nativeCur, s.cur, usdRate);
  const unit = calcUnit();
  const total = unit * s.qty;
  const canUah = s.nativeCur === '$' && usdRate > 0;
  const curLabel = s.cur === 'UAH' ? '₴' : (s.cur || 'сума');
  const valShown = isNaN(s.value) ? 0 : s.value;
  const unitTxt = s.kind === 'pct' ? '%' : (' ' + curLabel);
  const changed = valShown > 0;

  const curSeg = canUah
    ? '<span class="ps-seg ps-seg-cur">' +
      '<button type="button" data-ps-cur="$"' + (s.cur === '$' ? ' class="on"' : '') + '>$</button>' +
      '<button type="button" data-ps-cur="UAH"' + (s.cur === 'UAH' ? ' class="on"' : '') + '>₴</button></span>'
    : '';

  return '' +
    '<div class="ps-calc">' +
      '<div class="ps-calc-base"><span>Ціна з прайсу</span>' +
        '<b>' + escapeHtml(formatCalcAmount(base, s.cur)) + '</b>' + curSeg + '</div>' +

      '<div class="ps-field"><span class="ps-label">Що робимо з ціною</span>' +
        '<div class="ps-seg ps-seg-wide">' +
          '<button type="button" data-ps-dir="add"' + (s.dir === 'add' ? ' class="on"' : '') + '>Націнка</button>' +
          '<button type="button" data-ps-dir="sub"' + (s.dir === 'sub' ? ' class="on"' : '') + '>Знижка</button>' +
        '</div></div>' +

      '<div class="ps-field"><label class="ps-label" for="ps-calc-value">' +
        (s.dir === 'add' ? 'Розмір націнки' : 'Розмір знижки') + '</label>' +
        '<div class="ps-amount">' +
          '<input type="number" id="ps-calc-value" class="ps-amount-input" inputmode="decimal" min="0" step="any" ' +
            'value="' + (isNaN(s.value) ? '' : s.value) + '" placeholder="0">' +
          '<span class="ps-seg">' +
            '<button type="button" data-ps-kind="pct"' + (s.kind === 'pct' ? ' class="on"' : '') + '>%</button>' +
            '<button type="button" data-ps-kind="flat"' + (s.kind === 'flat' ? ' class="on"' : '') + '>' + escapeHtml(curLabel) + '</button>' +
          '</span>' +
        '</div></div>' +

      '<div class="ps-field"><span class="ps-label">Кількість</span>' +
        '<div class="ps-qty">' +
          '<button type="button" class="ps-qty-btn" data-ps-qty="-" aria-label="Менше">−</button>' +
          '<input type="number" class="ps-qty-input" inputmode="numeric" min="1" step="1" value="' + s.qty + '" aria-label="Кількість">' +
          '<button type="button" class="ps-qty-btn" data-ps-qty="+" aria-label="Більше">+</button>' +
        '</div></div>' +

      psTotalsHtml() +
    '</div>';
}

/* Підсумок окремо: при вводі числа перемальовуємо ЛИШЕ його, щоб у полі не стрибав
   курсор і не закривалась екранна клавіатура на телефоні. */
function psTotalsHtml() {
  const s = psState;
  const base = convertAmount(s.price, s.nativeCur, s.cur, usdRate);
  const unit = calcUnit();
  const total = unit * s.qty;
  const valShown = isNaN(s.value) ? 0 : s.value;
  const changed = valShown > 0;
  const curLabel = s.cur === 'UAH' ? '₴' : (s.cur || 'сума');
  const unitTxt = s.kind === 'pct' ? '%' : (' ' + curLabel);
  return '<div class="ps-total" id="ps-total">' +
      '<div class="ps-total-line"><span>Ціна з прайсу</span><span>' + escapeHtml(formatCalcAmount(base, s.cur)) + '</span></div>' +
      (changed
        ? '<div class="ps-total-line"><span>' + (s.dir === 'add' ? 'Націнка ' : 'Знижка ') +
          escapeHtml(String(valShown)) + escapeHtml(unitTxt) + '</span><span>' +
          escapeHtml(formatCalcAmount(unit, s.cur)) + '</span></div>'
        : '') +
      (s.qty > 1 ? '<div class="ps-total-line"><span>Кількість</span><span>× ' + s.qty + '</span></div>' : '') +
      '<div class="ps-total-sum"><span>' + (s.qty > 1 ? 'Разом' : 'Ціна для клієнта') + '</span>' +
        '<b>' + escapeHtml(formatCalcAmount(total, s.cur)) + '</b></div>' +
      (changed || s.qty > 1 ? '<button type="button" class="ps-reset" data-ps-reset>Скинути розрахунок</button>' : '') +
    '</div>';
}

function psUpdateTotals() {
  const el = document.getElementById('ps-total');
  if (el) el.outerHTML = psTotalsHtml();
}

/* ---------- Поділитись ---------- */

/* Текст збирається ТУТ, із даних панелі, а не вичитується з DOM рядка, як робив старий
   обробник. Показуємо його перед відправкою: дилер надсилає це клієнту, і побачити, що
   саме піде, важливіше за зекономлений дотик (рішення власника 2026-10-09). */
function shareText() {
  const s = psState;
  const lines = [s.model];
  if (s.tileLabel) lines.push(s.tileLabel);
  if (!s.locked) {
    const unit = calcUnit();
    const total = unit * s.qty;
    lines.push('Ціна: ' + formatCalcAmount(unit, s.cur) + (s.qty > 1 ? ' за шт.' : ''));
    if (s.qty > 1) lines.push('Кількість: ' + s.qty + ' · разом ' + formatCalcAmount(total, s.cur));
  }
  if (s.siteUrl) lines.push(s.siteUrl);
  return lines.join('\n');
}

function shareHtml() {
  return '<div class="ps-block-title">Що піде клієнту</div>' +
    '<pre class="ps-share-preview">' + escapeHtml(shareText()) + '</pre>' +
    '<div class="ps-share-actions">' +
      '<button type="button" class="ps-btn ps-btn-main" data-ps-send>' + ic('share-2', '') + '<span>Надіслати</span></button>' +
      '<button type="button" class="ps-btn" data-ps-copy>' + ic('check', '') + '<span>Скопіювати</span></button>' +
    '</div>' +
    '<p class="ps-hint">Ціна береться з вкладки «Розрахунок» — змініть націнку там, і текст оновиться.</p>';
}

/* ---------- Складання панелі ---------- */

function findPriceItem(cfgKey, model) {
  const list = (sheetsData && sheetsData[cfgKey]) || [];
  return list.find(function (it) { return it.model === model; }) || null;
}

function psTabBody() {
  const s = psState;
  if (s.tab === 'calc') {
    return s.locked ? '<div class="ps-empty">Розрахунок доступний після входу.</div>' : calcHtml();
  }
  if (s.tab === 'share') return shareHtml();
  if (s.specs === undefined) return '<div class="ps-loading">Завантажуємо характеристики…</div>';
  return specsHtml(s.specs);
}

function psRender() {
  const s = psState;
  if (!s) return;
  const body = document.getElementById('product-sheet-body');
  const stockHtml = (!s.locked && window.Stock && s.stockParts)
    ? '<button type="button" class="ps-stock-btn" data-ps-stock>' + ic('factory', '') + '<span>Наявність</span></button>' : '';
  const priceHtml = s.locked
    ? '<div class="ps-price ps-price-locked">' + ic('lock', '—') + '<span>Ціна доступна після входу</span></div>'
    : '<div class="ps-price">' + escapeHtml(formatListPrice(s.item)) + '</div>';
  const tab = function (id, label) {
    return '<button type="button" class="ps-tab' + (s.tab === id ? ' on' : '') + '" data-ps-tab="' + id + '">' + label + '</button>';
  };
  body.innerHTML =
    '<div class="ps-price-row">' + priceHtml + stockHtml + '</div>' +
    '<div class="ps-tabs">' + tab('specs', 'Характеристики') + tab('share', 'Поділитись') + tab('calc', 'Розрахунок') + '</div>' +
    '<div class="ps-tabbody">' + psTabBody() + '</div>' +
    (s.siteUrl ? '<a class="ps-site-link" href="' + escapeHtml(s.siteUrl) + '" target="_blank" rel="noopener">Відкрити картку на сайті ↗</a>' : '');
}

/* Перемальовує ЛИШЕ тіло вкладки — щоб під час вводу числа не перестрибував фокус
   і не збивалась клавіатура на телефоні. */
function psRenderTabBody() {
  const el = document.querySelector('#product-sheet-body .ps-tabbody');
  if (el) el.innerHTML = psTabBody();
}

function openProductSheet(cfgKey, model, tileLabel) {
  const it = findPriceItem(cfgKey, model);
  if (!it) return;
  const esc = (window.CSS && CSS.escape) ? CSS.escape(model) : model;
  const row = document.querySelector('.row[data-row-model="' + esc + '"]');
  const slot = row ? row.querySelector('.stock-slot') : null;
  let stockParts = null;
  try {
    stockParts = slot ? JSON.parse(decodeURIComponent(slot.getAttribute('data-stock-parts'))) : null;
  } catch (e) { stockParts = null; }
  const slug = (siteLinks && siteLinks.links && siteLinks.links[cfgKey])
    ? siteLinks.links[cfgKey][siteLinkKey(it)] : null;

  psState = {
    cfgKey: cfgKey, model: model, tileLabel: tileLabel || '', item: it,
    locked: !hasFullAccess,
    price: it.price, nativeCur: it.currency || '', cur: it.currency || '',
    dir: 'add', kind: 'pct', value: NaN, qty: 1,
    tab: hasFullAccess ? 'calc' : 'specs',   // умовчання — «Розрахунок» (рішення власника)
    specs: undefined, stockParts: stockParts,
    siteUrl: slug ? ((siteLinks.base || 'https://sun-ice.com.ua/') + slug) : null
  };

  document.getElementById('product-sheet-title').textContent = it.model;
  psRender();
  document.getElementById('product-sheet-overlay').classList.add('show');
  history.pushState({ tab: currentTab, tile: activeTile, sheet: 'product' }, '', location.hash);

  if (!SPECS_FILES[cfgKey]) {
    psState.specs = null;
    if (psState.tab === 'specs') psRenderTabBody();
    return;
  }
  loadSpecs(cfgKey).then(function (all) {
    if (!psState || psState.model !== model) return;   // встигли відкрити інший товар
    psState.specs = (all && slug) ? (all[slug] || null) : null;
    if (psState.tab === 'specs') psRenderTabBody();
  });
}

function closeProductSheet() {
  document.getElementById('product-sheet-overlay').classList.remove('show');
  psState = null;
}
