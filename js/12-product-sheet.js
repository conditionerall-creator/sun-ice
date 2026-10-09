/* Sun-ice — панель товару (П-9 … П-12)
   Частина переробки інтерфейсу 2026-10-08/09. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна.

   Панель відкривається дотиком по рядку прайсу — по назві, ціні або порожньому місцю
   (рішення власника 2026-10-09, друга частина): рядок має одну дію, а перехід на сайт
   живе ВСЕРЕДИНІ панелі кнопкою «На сайт ↗». Окремо лишилась тільки «Додати» —
   вона панель не відкриває.

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

/* Фото картки товару з сайту (2026-10-09, прохання власника: «у кожній картці зверху
   характеристик — фото з картки товару на сайті»).
   Окремий файл на всі шість розділів, а не поле в specs-*.json: інакше за фото
   довелось би перезбирати всі 275 карток із таблицями. Будує
   claude/site-catalog/build_card_images.py — там же пояснено, чому офлайн (сайт без CORS).
   Самі зображення віддає sun-ice.com.ua; <img> для цього CORS не потрібен. */
const CARD_IMAGES_FILE = 'data/card-images.json';
let cardImages = null;
let cardImagesPromise = null;

function loadCardImages() {
  if (cardImages) return Promise.resolve(cardImages);
  if (!cardImagesPromise) {
    cardImagesPromise = fetch(CARD_IMAGES_FILE + '?v=' + APP_BUILD)
      .then(r => r.ok ? r.json() : null)
      .then(j => { cardImages = j && j.images ? j : { base: '', images: {} }; return cardImages; })
      .catch(() => { cardImages = { base: '', images: {} }; return cardImages; });
  }
  return cardImagesPromise;
}

function cardImageUrl(slug) {
  if (!slug || !cardImages || !cardImages.images) return null;
  const p = cardImages.images[slug];
  return p ? ((cardImages.base || 'https://sun-ice.com.ua/') + p) : null;
}

/* Стан відкритої панелі. Скидається при кожному відкритті — калькулятор не повинен
   «пам'ятати» знижку з попереднього товару, це була б тиха пастка. */
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

/* Фото картки — найперше у вкладці, над характеристиками. Якщо фото не завантажилось
   (немає мережі, картинку на сайті перейменували) — блок прибирає себе сам, щоб замість
   фото не висіла «порвана» іконка. */
function psPhotoHtml() {
  const s = psState;
  if (!s || !s.img) return '';
  return '<div class="ps-photo"><img src="' + escapeHtml(s.img) + '" alt="' + escapeHtml(s.model) +
         '" loading="lazy" onerror="this.parentNode.remove()"></div>';
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

/* ---------- Розрахунок ---------- */

/* Перероблено 2026-10-09 (друга правка власника). Головне спостереження: щоденна дія
   дилера — ОДНА, «відняти свою знижку від прайсу». Тому перший екран показує рівно це:
   напис «Моя знижка», одне велике поле на відсотки й результат під ним. Поки знижку не
   ввели, результат — ціна з прайсу (нічого не «обнуляється» й не зникає).
   Усе інше (знижка сумою, націнка, кількість, скидання) — за кнопкою «Додаткові
   розрахунки». Перший варіант показував це все одразу: перемикач знижка/націнка,
   %/сума, кількість і валюту — для основної дії це була зайва вага.
   Кнопки «Розрахувати» немає й не було: усе перераховується на ходу.
   Математика та сама, що й у старому калькуляторі в рядку прайсу. */
function psNum(v) { return (isNaN(v) || v < 0) ? 0 : v; }
function psCurLabel() { return psState.cur === 'UAH' ? '₴' : (psState.cur || ''); }
function psCanUah() { return psState.nativeCur === '$' && usdRate > 0; }
function psBasePrice() {
  const s = psState;
  return convertAmount(s.price, s.nativeCur, s.cur, usdRate);
}
/* Ціна після знижки. Націнка завжди йде ВІД ЦЬОГО числа — так, як рахує дилер:
   спершу своя знижка від прайсу, потім своя націнка на те, що вийшло. Коли знижки
   немає, це рівно ціна з прайсу, тому «пряма націнка на прайс» окремої кнопки не
   потребує: лишаєш знижку порожньою — і націнка рахується від прайсу (підпис під
   полем «Націнка» сам це й каже). */
function psAfterDiscount() {
  const s = psState, b = psBasePrice(), d = psNum(s.disc);
  const r = s.discKind === 'pct' ? b * (1 - d / 100) : b - d;
  return r < 0 ? 0 : r;
}
function calcUnit() {
  const s = psState, a = psAfterDiscount(), m = psNum(s.mark);
  const r = s.markKind === 'pct' ? a * (1 + m / 100) : a + m;
  return r < 0 ? 0 : r;
}

function calcHtml() {
  const s = psState;
  return '' +
    '<div class="ps-calc">' +
      '<div class="ps-disc-head">' +
        '<span class="ps-disc-label">Моя знижка</span>' +
        '<button type="button" class="ps-adv-toggle' + (s.adv ? ' on' : '') + '" data-ps-adv ' +
          'aria-expanded="' + (s.adv ? 'true' : 'false') + '">Додаткові розрахунки' +
          '<span class="ps-chev">▾</span></button>' +
      '</div>' +
      '<div class="ps-disc-row">' +
        '<input type="number" id="ps-disc" class="ps-amount-input" inputmode="decimal" ' +
          'min="0" step="any" aria-label="Моя знижка" value="' + (isNaN(s.disc) ? '' : s.disc) + '">' +
        '<span class="ps-disc-unit">' + escapeHtml(s.discKind === 'pct' ? '%' : psCurLabel()) + '</span>' +
      '</div>' +
      (s.adv ? psAdvHtml() : '') +
      psResultHtml() +
      psShareHtml() +
    '</div>';
}

/* Перемикач «% / сума» — той самий вигляд, що й раніше, але тепер лише в додаткових
   розрахунках: на першому екрані знижка в відсотках, бо так її дилеру й дають. */
function psSegHtml(attr, cur) {
  const cl = psCurLabel();
  return '<span class="ps-seg">' +
      '<button type="button" data-ps-' + attr + '="pct"' + (cur === 'pct' ? ' class="on"' : '') + '>%</button>' +
      '<button type="button" data-ps-' + attr + '="flat"' + (cur === 'flat' ? ' class="on"' : '') + '>' +
        escapeHtml(cl) + '</button>' +
    '</span>';
}

function psAdvHtml() {
  const s = psState;
  return '<div class="ps-adv">' +
      '<div class="ps-adv-row">' +
        '<span class="ps-adv-label">Знижка<small>відсотком або сумою</small></span>' +
        psSegHtml('disckind', s.discKind) +
      '</div>' +
      '<div class="ps-adv-row">' +
        '<span class="ps-adv-label">Націнка<small id="ps-mark-basis">' + psMarkBasisText() + '</small></span>' +
        '<input type="number" id="ps-mark" class="ps-adv-input" inputmode="decimal" min="0" step="any" ' +
          'aria-label="Націнка" value="' + (isNaN(s.mark) ? '' : s.mark) + '">' +
        psSegHtml('markkind', s.markKind) +
      '</div>' +
      '<div class="ps-adv-row">' +
        '<span class="ps-adv-label">Кількість</span>' +
        '<div class="ps-qty">' +
          '<button type="button" class="ps-qty-btn" data-ps-qty="-" aria-label="Менше">−</button>' +
          '<input type="number" class="ps-qty-input" inputmode="numeric" min="1" step="1" value="' + s.qty + '" aria-label="Кількість">' +
          '<button type="button" class="ps-qty-btn" data-ps-qty="+" aria-label="Більше">+</button>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="ps-reset" data-ps-reset>Скинути розрахунок</button>' +
    '</div>';
}

/* Підпис під «Націнкою» мусить називати, НА ЩО саме йде відсоток — інакше незрозуміло,
   від якої суми порахували (зауваження по першій версії). */
function psMarkBasisText() {
  return psNum(psState.disc) > 0 ? 'на ціну зі знижкою' : 'на ціну з прайсу';
}

/* Результат. Прозорий (П-12): видно, з чого склалась цифра, а не лише саму цифру.
   Назва підсумку залежить від того, що порахували:
   • нічого не ввели — «Ціна з прайсу» (вимога власника: поле порожнє → видно прайс);
   • лише знижка — «Ціна зі знижкою» (НЕ «Ціна для клієнта»: після дилерської знижки
     це закупівельна ціна самого дилера, і стара назва вводила в оману);
   • є націнка — «Ціна для клієнта».
   Перемикач $/₴ стоїть поруч із підсумком — там, де на нього дивляться. */
function psResultHtml() {
  const s = psState;
  const b = psBasePrice(), a = psAfterDiscount(), unit = calcUnit();
  const d = psNum(s.disc), m = psNum(s.mark);
  const f = function (v) { return escapeHtml(formatCalcAmount(v, s.cur)); };
  const lines = [];
  if (d > 0 || m > 0) lines.push(['Ціна з прайсу', f(b)]);
  if (d > 0) {
    lines.push(['Знижка ' + (s.discKind === 'pct' ? d + ' %' : f(d)), '− ' + f(b - a)]);
  }
  if (m > 0) {
    lines.push(['Націнка ' + (s.markKind === 'pct' ? m + ' %' : f(m)) + ' ' + psMarkBasisText(),
      '+ ' + f(unit - a)]);
  }
  let label = m > 0 ? 'Ціна для клієнта' : (d > 0 ? 'Ціна зі знижкою' : 'Ціна з прайсу');
  if (s.qty > 1) {
    lines.push([label + ' за 1 шт.', f(unit)]);
    lines.push(['Кількість', '× ' + s.qty]);
    label = 'Разом';
  }
  return '<div class="ps-result" id="ps-result">' +
      lines.map(function (l) {
        return '<div class="ps-total-line"><span>' + l[0] + '</span><span>' + l[1] + '</span></div>';
      }).join('') +
      '<div class="ps-total-sum"><span>' + label + '</span>' +
        '<span class="ps-sum-right"><b>' + f(unit * s.qty) + '</b>' +
        (psCanUah() ? '<span class="ps-seg ps-seg-cur">' +
            '<button type="button" data-ps-cur="$"' + (s.cur === '$' ? ' class="on"' : '') + '>$</button>' +
            '<button type="button" data-ps-cur="UAH"' + (s.cur === 'UAH' ? ' class="on"' : '') + '>₴</button>' +
          '</span>' : '') +
        '</span>' +
      '</div>' +
    '</div>';
}

/* При вводі числа перемальовуємо ЛИШЕ результат (і підпис основи націнки), щоб у полі
   не стрибав курсор і не закривалась екранна клавіатура на телефоні. */
function psUpdateResult() {
  const el = document.getElementById('ps-result');
  if (el) el.outerHTML = psResultHtml();
  const basis = document.getElementById('ps-mark-basis');
  if (basis) basis.textContent = psMarkBasisText();
  const pv = document.getElementById('ps-share-preview');
  if (pv) pv.textContent = shareText();
}

/* ---------- Поділитись ---------- */

/* Окремої вкладки більше немає (зауваження власника 2026-10-09): сама по собі вона
   майже нічого не робила. Кнопка стоїть тут, під розрахунком — там, де щойно вивели
   ціну, яку й треба надіслати.
   Текст навмисно короткий: лише маркування й ціна, без підписів розділу та інших
   поміток. Посилання на сайт — за галочкою, бо потрібне не завжди. */
function shareText() {
  const s = psState;
  const lines = [s.model];
  if (!s.locked) {
    const unit = calcUnit();
    lines.push(s.qty > 1
      ? formatCalcAmount(unit, s.cur) + ' × ' + s.qty + ' = ' + formatCalcAmount(unit * s.qty, s.cur)
      : formatCalcAmount(unit, s.cur));
  }
  if (s.withLink && s.siteUrl) lines.push(s.siteUrl);
  return lines.join('\n');
}

function psShareHtml() {
  const s = psState;
  return '<div class="ps-share">' +
      '<button type="button" class="ps-share-btn" data-ps-send>' + ic('share-2', '') + '<span>Поділитись</span></button>' +
      (s.siteUrl
        ? '<label class="ps-link-check"><input type="checkbox" data-ps-link' + (s.withLink ? ' checked' : '') + '>' +
          '<span>Додати посилання на сайт</span></label>'
        : '') +
      '<pre class="ps-share-preview" id="ps-share-preview">' + escapeHtml(shareText()) + '</pre>' +
    '</div>';
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
  /* Наявність — ТРЕТЯ РІВНОПРАВНА ВКЛАДКА (рішення власника 2026-10-09, третя правка).
     Була кнопкою в рядку з ціною: по-перше, «подорожувала» по рядку, бо ціни різної
     довжини, по-друге, розкривалась НАД вкладками й затуляла їх собою. Тепер поводиться
     рівно як дві інші: той самий вигляд, те саме місце, вміст міняється всередині.
     data-stock-parts на обгортці — щоб кнопка «Повна інформація» всередині панелі
     stock.js знайшла свої дані (рядка прайсу .row у панелі немає). */
  if (s.tab === 'stock') {
    if (!psHasStock()) return '<div class="ps-empty">Дані про залишки недоступні.</div>';
    let inner;
    try { inner = Stock.panelHtml(s.stockParts); }
    catch (e) { return '<div class="ps-empty">Дані про залишки ще не завантажились.</div>'; }
    return '<div class="ps-stock-wrap" data-stock-parts="' +
      escapeHtml(encodeURIComponent(JSON.stringify(s.stockParts))) + '">' + inner + '</div>';
  }
  /* Фото картки — над характеристиками (прохання власника 2026-10-09). */
  if (s.specs === undefined) return psPhotoHtml() + '<div class="ps-loading">Завантажуємо характеристики…</div>';
  return psPhotoHtml() + specsHtml(s.specs);
}

/* Наявність з 1С бачать ЛИШЕ адміни (rateViewerIsAdmin = regional_admin/super_admin).
   Технічно дані й так приходять тільки їм (RPC get_stock під RLS), але кнопка не
   повинна з'являтись у звичайного дилера навіть на мить. */
function psHasStock() {
  const s = psState;
  return !!(s && !s.locked && rateViewerIsAdmin && window.Stock && Stock.panelHtml && s.stockParts);
}

function psRender() {
  const s = psState;
  if (!s) return;
  const body = document.getElementById('product-sheet-body');
  const priceHtml = s.locked
    ? '<div class="ps-price ps-price-locked">' + ic('lock', '—') + '<span>Ціна доступна після входу</span></div>'
    : '<div class="ps-price">' + escapeHtml(formatListPrice(s.item)) + '</div>';
  const tab = function (id, label) {
    return '<button type="button" class="ps-tab' + (s.tab === id ? ' on' : '') + '" data-ps-tab="' + id + '">' + label + '</button>';
  };
  /* «Наявність» — ПОСЕРЕДИНІ стрічки (прохання власника: «нехай це буде по центру
     рядка»). У адміна три кнопки однакового вигляду, у звичайного дилера — дві. */
  body.innerHTML =
    '<div class="ps-price-row">' + priceHtml +
      (s.siteUrl ? '<a class="ps-site-link" href="' + escapeHtml(s.siteUrl) + '" target="_blank" rel="noopener">На сайт ↗</a>' : '') +
    '</div>' +
    '<div class="ps-tabs">' + tab('calc', 'Розрахунок') +
      (psHasStock() ? tab('stock', 'Наявність') : '') + tab('specs', 'Характеристики') + '</div>' +
    '<div class="ps-tabbody">' + psTabBody() + '</div>';
}

/* Підсвічування активної вкладки без перемальовки всієї панелі: шапка й кнопки
   лишаються на місці, міняється тільки вміст — панель не «моргає». */
function psSyncTabs() {
  document.querySelectorAll('#product-sheet-body .ps-tab').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-ps-tab') === psState.tab);
  });
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
    /* знижка відсотком — єдина дія першого екрана; решта за «Додатковими розрахунками» */
    disc: NaN, discKind: 'pct', mark: NaN, markKind: 'pct', qty: 1, adv: false, withLink: false,
    tab: hasFullAccess ? 'calc' : 'specs',   // умовчання — «Розрахунок» (рішення власника)
    specs: undefined, slug: slug || null, img: cardImageUrl(slug),
    stockParts: stockParts,
    siteUrl: slug ? ((siteLinks.base || 'https://sun-ice.com.ua/') + slug) : null
  };

  document.getElementById('product-sheet-title').textContent = it.model;
  psRender();
  document.getElementById('product-sheet-overlay').classList.add('show');
  history.pushState({ tab: currentTab, tile: activeTile, sheet: 'product' }, '', location.hash);
  psState.pushed = true;   // є свій запис в історії — закривати тільки через history.back()

  /* Фото картки: файл один на всі розділи, тому вантажимо раз і далі беремо з пам'яті. */
  if (slug && !cardImages) {
    loadCardImages().then(function () {
      if (!psState || psState.model !== model) return;
      psState.img = cardImageUrl(slug);
      if (psState.tab === 'specs') psRenderTabBody();
    });
  }

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

/* ЗАКРИТТЯ ПАНЕЛІ — ДВА РІЗНІ ШЛЯХИ, і їх не можна плутати (виправлено 2026-10-09).
   Відкриття робить history.pushState. Якщо хрестик і підложка просто ховали б панель
   (саме так і було), запис в історії ЛИШАВСЯ Б. Відкрив-закрив панель кілька разів — і
   в історії стільки ж порожніх записів; далі «Назад» відмотує їх по одному, щоразу
   відновлюючи стару позицію прокрутки. Саме це власник і описав: «жмеш назад, екран
   здвинеться, ще раз нажав, ще трохи».
   dismissProductSheet() — коли закриває ЛЮДИНА: віддаємо команду історії, а панель
   закриє вже обробник popstate. closeProductSheet() — власне закриття DOM, його
   викликає лише popstate. */
function dismissProductSheet() {
  if (psState && psState.pushed) { history.back(); return; }
  closeProductSheet();
}

function closeProductSheet() {
  const ov = document.getElementById('product-sheet-overlay');
  ov.classList.remove('show');
  ov.classList.remove('sheet-tall');
  psState = null;
}

/* «Назад» усередині панелі = мінус одна дія, а не вихід одразу (прохання власника).
   Перший «Назад» згортає все, що розгорнуто в характеристиках, другий — закриває панель.
   Свідомо НЕ робимо окремий крок історії на КОЖЕН розгорнутий блок: їх буває дванадцять,
   і тоді щоб вийти з панелі довелось би тиснути «Назад» дюжину разів — це гірше за
   проблему, яку лікуємо. Один крок згортає все розгорнуте разом. */
function psCollapseOpenDetails() {
  const open = document.querySelectorAll('#product-sheet-body details[open]');
  if (!open.length) return false;
  open.forEach(function (d) { d.open = false; });
  const sc = document.querySelector('#product-sheet-body .ps-tabbody');
  if (sc) sc.scrollTop = 0;
  return true;
}
