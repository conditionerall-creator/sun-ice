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

/* ⚠️ 2026-10-19: збій мережі більше НЕ кешується як «характеристик немає».
   Було: catch писав порожній об'єкт у specsCache назавжди, і той самий розділ до
   перезапуску застосунку показував «немає характеристик» навіть після повернення
   мережі. Тепер при помилці кеш не заповнюємо й відпускаємо specsLoading — наступне
   відкриття картки (або повторна спроба) піде в мережу знову. Порожній результат від
   СЕРВЕРА (файл є, даних немає) кешуємо, як і раніше: це відповідь, а не збій. */
function loadSpecs(cfgKey) {
  if (specsCache[cfgKey]) return Promise.resolve(specsCache[cfgKey]);
  if (!SPECS_FILES[cfgKey]) return Promise.resolve(null);
  if (specsLoading[cfgKey]) return specsLoading[cfgKey];
  specsLoading[cfgKey] = fetch(SPECS_FILES[cfgKey] + '?v=' + APP_BUILD)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => {
      specsCache[cfgKey] = (j && j.specs) || {};
      specsLoading[cfgKey] = null;
      return specsCache[cfgKey];
    })
    .catch(() => { specsLoading[cfgKey] = null; return null; });   // null = «не вдалося», не «порожньо»
  return specsLoading[cfgKey];
}

/* ТЕХНІЧНІ ДАНІ З КАТАЛОГУ MHI (з 2026-10-19).
   Джерело правди для характеристик — друкований каталог, а не картка сайту
   (власник: «на сайті все не точно і не так повно»). Файл збирає
   claude/mhi-catalog/build_catalog.py по координатах слів у PDF; у кожного
   значення є номер сторінки.
   Модель, якої в каталозі ще немає, працює як раніше — на даних із сайту. */
const MHI_CATALOG_FILE = 'data/mhi-catalog.json';
let mhiCatalog = null;
let mhiCatalogPromise = null;
let mhiCatalogFailed = false;

function loadMhiCatalog() {
  if (mhiCatalog) return Promise.resolve(mhiCatalog);
  if (mhiCatalogPromise) return mhiCatalogPromise;
  mhiCatalogPromise = fetch(MHI_CATALOG_FILE + '?v=' + APP_BUILD)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { mhiCatalog = j; mhiCatalogPromise = null; mhiCatalogFailed = false; return j; })
    .catch(() => { mhiCatalogPromise = null; mhiCatalogFailed = true; return null; });
  return mhiCatalogPromise;
}

/* Ключ маркування для каталогу: верхній регістр, без пробілів, дефісів і підкреслень.
   МУСИТЬ збігатися з norm_model() у claude/mhi-catalog/pdfgrid.py — саме так зібрано
   index у файлі. psKey() тут не годиться: він лишає дефіси, і жодне маркування
   («SRK35ZSX-W» проти «SRK35ZSXW») не знайшлося б. */
function catKey(s) { return psKey(s).replace(/[-_]/g, ''); }

/* Серія + колонка каталогу для цього товару. Пробуємо всі маркування рядка
   (внутрішній, зовнішній): у прайсі комплект може бути записаний по-різному. */
function mhiCatalogHit(cfgKey, it) {
  if (!mhiCatalog || !mhiCatalog.index) return null;
  /* Індекс РОЗДІЛЬНИЙ по розділах застосунку. У мульти спліт-системі внутрішні
     блоки мають ТІ САМІ маркування (SRK20ZSX-W), але працюють з іншим зовнішнім
     блоком — споживана потужність, труби й заправка там інші. Спільний індекс
     тихо підставив би їм дані зі сторінки спліта. */
  const idx = mhiCatalog.index[cfgKey];
  if (!idx) return null;
  const marks = psMarkings(cfgKey, it);
  for (let i = 0; i < marks.length; i++) {
    const ref = idx[catKey(marks[i])];
    if (!ref) continue;
    const bits = String(ref).split('|');
    const series = mhiCatalog.series && mhiCatalog.series[bits[0]];
    /* mark — маркування САМЕ цього товару (у колонці каталогу їх кілька: -W, -WB,
       -WT, -WF…). Потрібне там, де відповідь залежить від виконання, а не від
       серії: у -WF Wi-Fi вбудований, у -W це опція. */
    if (series) {
      const col = parseInt(bits[1], 10);
      return { series: series, col: col, model: (series.columns || [])[col] || '',
               key: bits[0], mark: catKey(marks[i]) };
    }
  }
  return null;
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

/* Те саме правило, що й у loadSpecs: збій мережі не записуємо як «фото немає». */
function loadCardImages() {
  if (cardImages) return Promise.resolve(cardImages);
  if (!cardImagesPromise) {
    cardImagesPromise = fetch(CARD_IMAGES_FILE + '?v=' + APP_BUILD)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => {
        cardImages = j && j.images ? j : { base: '', images: {} };
        cardImagesPromise = null;
        return cardImages;
      })
      .catch(() => { cardImagesPromise = null; return null; });
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

/* ---------- Характеристики з каталогу MHI ---------- */

/* Десять рядків, які видно одразу (порядок і склад — рішення власника 2026-10-19).
   Решта таблиці — під кнопкою «Усі характеристики», і там ці десять теж є:
   власник просив бачити таблицю так само, як у друкованому каталозі, а не
   «залишок» без початку. */
/* Десять рядків, які видно одразу (склад і порядок — рішення власника 2026-10-19).
   Решта таблиці — під кнопкою «Усі характеристики», і там ці десять теж є:
   власник просив бачити таблицю так само, як у друкованому каталозі.
   Зіставляємо за ПОЧАТКОМ назви: у різних серіях хвіст буває різний
   («Холодоагент · Заводська заправка» на стор. 34, «Холодоагент · Charge» на 51). */
const CAT_KEY_ROWS = [
  'Холодопродуктивність',
  'Теплопродуктивність',
  'SEER',
  'Розміри · Внутр',
  'Розміри · Зовнішн',
  'Міжлапна',
  'Максимальна довжина труб',
  'Макс. перепад висот',
  'Холодоагент · Заводська', 'Холодоагент · Charge',
  'Дозаправка'
];

/* Значення немає в каталозі → «—». Не підставляти «як у сусіда» й не рахувати. */
function catValue(spec, col) {
  const v = spec && spec.values ? spec.values[col] : null;
  return (v === undefined || v === null || v === '') ? '—' : v;
}

function catRowsHtml(list, col) {
  return list.map(function (sp) {
    const unit = sp.unit ? ' <span class="ps-spec-unit">' + escapeHtml(sp.unit) + '</span>' : '';
    return '<div class="ps-spec-row"><span class="ps-spec-name">' + escapeHtml(sp.name) + unit +
           '</span><span class="ps-spec-val">' + escapeHtml(catValue(sp, col)) + '</span></div>';
  }).join('');
}

function catSpecsHtml(hit) {
  const all = hit.series.specs || [];
  const key = [];
  CAT_KEY_ROWS.forEach(function (pref) {
    all.forEach(function (sp) {
      if (sp.name.indexOf(pref) === 0 && key.indexOf(sp) < 0) key.push(sp);
    });
  });
  return '<div class="ps-spec-table">' + catRowsHtml(key, hit.col) + '</div>' +
    '<details class="ps-all"><summary><span>Усі характеристики</span>' +
    '<span class="ps-group-n">' + all.length + '</span></summary>' +
    '<div class="ps-spec-table">' + catRowsHtml(all, hit.col) + '</div></details>' +
    catSourceHtml(hit);
}

/* Звідки взято — щоб будь-яку цифру можна було перевірити за десять секунд. */
function catSourceHtml(hit) {
  return '<div class="ps-source">Джерело: каталог Mitsubishi Heavy Industries, ' +
    escapeHtml(hit.series.marking || hit.series.title || '') +
    (hit.series.series ? ' (' + escapeHtml(hit.series.series) + ')' : '') +
    ', стор. ' + hit.series.page + '.</div>';
}

/* Назви функцій у каталозі набрані капсом. Тридцять таких рядків поспіль читати
   важко, тому кирилицю опускаємо до звичайного вигляду, а латиницю (FUZZY AUTO,
   ECO, HIGH POWER) лишаємо як є — це назви режимів, вони так і пишуться.
   Зміст не чіпаємо: це лише регістр. */
function catNiceName(name) {
  const low = name.split(' ').map(function (w) {
    return /[А-ЯЁІЇЄҐ]/.test(w) && !/[A-Z]/.test(w) ? w.toLowerCase() : w;
  }).join(' ').replace(/\bWI-FI\b/i, 'Wi-Fi');
  return low.charAt(0).toUpperCase() + low.slice(1);
}

/* Стан функції/аксесуара для КОНКРЕТНОГО виконання, а не для серії загалом
   (рішення власника 2026-10-19: «сторінці товару віримо і відповідно до неї
   робимо»). Поки що так відрізняється лише Wi-Fi. */
function catWifiBuiltin(hit) {
  const pat = hit.series.wifi_builtin;
  return !!(pat && hit.mark && hit.mark.indexOf(pat) >= 0);
}
/* Виноска теж залежить від виконання: у -WF показувати «для типів -W потрібно
   доставити модуль» — означає плутати людину тим, що її моделі не стосується.
   Обидва речення взяті зі сторінки каталогу. */
function catNoteFor(hit, item) {
  const isWifi = /WI-?FI/i.test(item.name) || item.kind === 'wifi';
  if (isWifi && hit.series.wifi_builtin && catWifiBuiltin(hit)) {
    return 'Wi-Fi-модуль вбудований у стандартній комплектації.';
  }
  return item.note;
}

function catStateFor(hit, item) {
  const isWifi = /WI-?FI/i.test(item.name) || item.kind === 'wifi';
  if (!isWifi) return item.state;
  if (!hit.series.wifi_builtin) return item.state;
  return catWifiBuiltin(hit) ? 'yes' : 'option';
}

/* Список функцій лежить у файлі ОДИН раз на колонку матриці стор. 33 — той
   самий внутрішній блок буває в кількох серіях. */
function catFunctions(hit) {
  const col = hit.series.funcs_col;
  if (col === null || col === undefined) return [];
  return (mhiCatalog.functions && mhiCatalog.functions[String(col)]) || [];
}

/* Функції: показуємо те, що в цій серії Є, і те, що доплатою. Чого немає —
   не малюємо: матриця каталогу спільна на 14 серій, і довгий список «немає»
   лише заважає читати. */
function catFuncsHtml(hit) {
  const list = catFunctions(hit);
  const block = function (title, state, empty) {
    const rows = list.filter(function (f) { return catStateFor(hit, f) === state; });
    if (!rows.length) return empty ? '<div class="ps-block-title">' + title + '</div>' +
      '<div class="ps-empty-line">' + empty + '</div>' : '';
    return '<div class="ps-block-title">' + title + '</div><div class="ps-fn-list">' +
      rows.map(function (f) {
        return '<div class="ps-fn"><span class="ps-fn-name">' + escapeHtml(catNiceName(f.name)) + '</span>' +
          (catNoteFor(hit, f) ? '<span class="ps-fn-note">' + escapeHtml(catNoteFor(hit, f)) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  };
  if (!list.length) return '<div class="ps-empty">Для цієї моделі перелік функцій у каталозі не знайшовся.</div>';
  return block('Є в цій серії', 'yes', 'Каталог не вказує жодної.') +
         block('Доступно як опція', 'option', '') +
         catSourceHtml(hit);
}

const CAT_ACC_TITLES = {
  remote: 'Пульти керування',
  adapter: 'Адаптери',
  wifi: 'Wi-Fi',
  filter: 'Фільтри'
};
const CAT_ACC_STATE = {
  yes: 'у комплекті',
  option: 'опція',
  depends: 'залежить від моделі'
};

function catAccHtml(hit) {
  const list = hit.series.accessories || [];
  if (!list.length) return '<div class="ps-empty">Для цієї моделі аксесуарів у каталозі не знайшлось.</div>';
  const order = ['remote', 'adapter', 'wifi', 'filter'];
  let html = '';
  order.forEach(function (kind) {
    const rows = list.filter(function (a) { return a.kind === kind; });
    if (!rows.length) return;
    html += '<div class="ps-block-title">' + escapeHtml(CAT_ACC_TITLES[kind] || kind) + '</div>' +
      '<div class="ps-fn-list">' + rows.map(function (a) {
        const st = catStateFor(hit, a);
        return '<div class="ps-fn"><span class="ps-fn-name">' + escapeHtml(a.name) +
          '<span class="ps-acc-state ps-acc-' + escapeHtml(st) + '">' +
          escapeHtml(CAT_ACC_STATE[st] || st) + '</span></span>' +
          (catNoteFor(hit, a) ? '<span class="ps-fn-note">' + escapeHtml(catNoteFor(hit, a)) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  });
  return html + catSourceHtml(hit);
}

/* ---------- Розрахунок (у шапці панелі) ---------- */

/* Переїхав у шапку 2026-10-19 (рішення власника за макетом): вкладки «Розрахунок» більше
   немає, поле знижки й ціна завжди перед очима, під ними — «Характеристики»/«Наявність».
   Щоденна дія дилера ОДНА — «відняти свою знижку від прайсу». «Додаткові розрахунки»
   (знижка сумою, націнка, кількість, скидання, галочка «посилання на сайт») прибрано за
   рішенням власника: зараз не потрібні. Повертати їх — окремим рішенням.
   Кнопки «Розрахувати» немає: усе перераховується на ходу. */
function psNum(v) { return (isNaN(v) || v < 0) ? 0 : v; }
function psCurLabel() { return psState.cur === 'UAH' ? '₴' : (psState.cur || ''); }
function psCanUah() { return psState.nativeCur === '$' && usdRate > 0; }
/* Якщо курс зник, поки панель відкрита (повернення в застосунок без мережі), валюту
   примусово вертаємо в рідну — інакше конвертер віддав би null, а підпис лишився б
   гривневим. Перемикач ₴ при наступному малюванні теж зникне: psCanUah() вже false. */
function psBasePrice() {
  const s = psState;
  const v = convertAmount(s.price, s.nativeCur, s.cur, usdRate);
  if (v === null) { s.cur = s.nativeCur; return s.price; }
  return v;
}
function psDiscPct() { return Math.min(100, psNum(psState.disc)); }
/* Ціна після знижки в відсотках. */
function calcUnit() {
  return psBasePrice() * (1 - psDiscPct() / 100);
}

/* Число й валюта окремо: число велике, валюта поруч меншою. Без знижки в рідній валюті
   показуємо рівно те, що в рядку прайсу (formatListPriceNumber) — щоб панель не
   розходилась із списком і діагностикою; з будь-яким розрахунком — округлення
   калькулятора (formatCalcAmount), яке власник просив не чіпати. */
function psAmountHtml(v, useList) {
  const s = psState;
  const num = useList ? formatListPriceNumber(s.item) : Math.round(v).toLocaleString('uk-UA');
  const cur = psCurLabel();
  return '<b>' + escapeHtml(num) + '</b>' + (cur ? '<small>' + escapeHtml(cur) + '</small>' : '');
}

/* Права частина шапки: назва ціни + число + (лише при знижці) орієнтир «Прайс: …».
   Назва динамічна (рішення власника 2026-10-19): без знижки — «Ціна з прайсу», зі
   знижкою — «Ваша ціна», а малою цифрою під нею лишається прайс як орієнтир. */
function psResultHtml() {
  const s = psState;
  const d = psDiscPct();
  const plain = d === 0 && s.cur === s.nativeCur;
  return '<div class="ps-hero-price" id="ps-result">' +
      '<div class="ps-hero-label">' + (d > 0 ? 'Ваша ціна' : 'Ціна з прайсу') + '</div>' +
      '<div class="ps-hero-sum">' + psAmountHtml(calcUnit(), plain) + '</div>' +
      (d > 0 ? '<div class="ps-hero-ref">Прайс: ' + escapeHtml(formatCalcAmount(psBasePrice(), s.cur)) + '</div>' : '') +
    '</div>';
}

/* Шапка з розрахунком: ряд 1 — [Знижка %] [₴/$] [Поділитись], ряд 2 — ціна. Перемикач валют —
   лише коли є курс. Для гостя без доступу до цін — тільки рядок про вхід. */
function psHeroHtml() {
  const s = psState;
  if (s.locked) {
    return '<div class="ps-hero ps-hero-locked">' + ic('lock', '—') + '<span>Ціна доступна після входу</span></div>';
  }
  return '<div class="ps-hero">' +
      '<div class="ps-hero-disc">' +
        '<label for="ps-disc" class="ps-hero-label">Знижка</label>' +
        '<div class="ps-disc-box">' +
          '<input type="number" id="ps-disc" class="ps-amount-input" inputmode="decimal" ' +
            'min="0" max="100" step="any" aria-label="Моя знижка, відсотків" ' +
            'value="' + (isNaN(s.disc) ? '' : s.disc) + '">' +
          '<span class="ps-disc-unit">%</span>' +
        '</div>' +
      '</div>' +
      (psCanUah()
        ? '<span class="ps-seg-cur" role="group" aria-label="Валюта">' +
            '<button type="button" data-ps-cur="UAH"' + (s.cur === 'UAH' ? ' class="on"' : '') + '>₴</button>' +
            '<button type="button" data-ps-cur="$"' + (s.cur === '$' ? ' class="on"' : '') + '>$</button>' +
          '</span>'
        : '') +
      psResultHtml() +
      '<button type="button" class="ps-share-btn" data-ps-send aria-label="Поділитись">' +
        '<span class="ps-share-ico">' + ic('share-2', '') + '</span><span>Поділитись</span></button>' +
    '</div>';
}

/* Підбір розміру шрифту, щоб текст ВМІСТИВСЯ В ОДИН РЯДОК (вимога власника 2026-10-19:
   переноси розтягують вікно). Береться найбільший розмір від max вниз із кроком 0,5px, при
   якому вміст не ширший за контейнер. Елемент мусить мати overflow:hidden і nowrap, а
   вимір має відбуватись, коли панель уже показано (у прихованої scrollWidth = 0). */
function psFit(el, maxPx, minPx) {
  if (!el || !el.clientWidth) return;
  let f = maxPx;
  el.style.fontSize = f + 'px';
  while (el.scrollWidth > el.clientWidth && f > minPx) {
    f -= 0.5;
    el.style.fontSize = f + 'px';
  }
}
function psFitAll() {
  psFit(document.getElementById('product-sheet-title'), 22, 9);
  psFit(document.querySelector('#product-sheet-body .ps-hero-sum'), 28, 12);
}

/* Перемальовує лише шапку-розрахунок (перемикання валюти). Під час вводу числа її НЕ
   чіпаємо — тільки psUpdateResult, щоб у полі не стрибав курсор і не закривалась
   екранна клавіатура на телефоні. */
function psRenderHero() {
  const el = document.querySelector('#product-sheet-body .ps-hero');
  if (el) el.outerHTML = psHeroHtml();
  psFitAll();
}

function psUpdateResult() {
  const el = document.getElementById('ps-result');
  if (el) el.outerHTML = psResultHtml();
  psFit(document.querySelector('#product-sheet-body .ps-hero-sum'), 28, 12);
}

/* ---------- Поділитись ---------- */

/* Кнопка стоїть у шапці, поруч із ціною, яку й треба надіслати. Текст навмисно
   короткий: маркування й ціна, без підписів розділу та інших поміток. */
function shareText() {
  const s = psState;
  const lines = [psMarkings(s.cfgKey, s.item).join(' / ')];
  if (!s.locked) lines.push(formatCalcAmount(calcUnit(), s.cur));
  return lines.join('\n');
}

/* ---------- Маркування й бренд ---------- */

/* Маркування в заголовку: комплект (внутрішній + зовнішній) → два, одиночний блок → одне.
   Джерела ті самі, що в Stock.partsFor (stock.js), але копія тут: stock.js вантажиться
   лише тим, хто бачить ціни, а заголовок мусить бути в усіх.
   • спліт: зовнішній — splitOutdoor рядка, а для кольорових варіантів (-WT/-WB), у яких
     рядка «зовніш.» у прайсі немає, — зовнішній «брата» з тією самою основою;
   • напівпром GAL: outdoorModel; напівпром MHI: маркування вже склеєні через «+»;
   • решта (мульти, окремий зовнішній/внутрішній блок): рівно те, що в прайсі. */
function psLead(s) { return String(s == null ? '' : s).split(/[,\n]/)[0].trim(); }
function psKey(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }
function psBaseOf(key) {
  const m = /-[WS]/.exec(key);
  return m ? key.slice(0, m.index + 2) : null;
}
function psMarkings(cfgKey, it) {
  const model = psLead(it.model);
  if (!model) return [String(it.model || '')];
  if (it.unitType === 'outdoor') return [model];
  if (cfgKey === 'split_mhi' || cfgKey === 'split_gal') {
    if (it.unitType !== 'indoor') return [model];
    let out = it.splitOutdoor || null;
    if (!out) {
      const base = psBaseOf(psKey(model));
      const list = (sheetsData && sheetsData[cfgKey]) || [];
      const sib = base && list.filter(function (x) {
        return x.splitOutdoor && x.unitType === 'indoor' && psBaseOf(psKey(psLead(x.model))) === base;
      })[0];
      if (sib) out = sib.splitOutdoor;
    }
    return out ? [model, out] : [model];
  }
  if (cfgKey === 'semi_gal') return it.outdoorModel ? [model, it.outdoorModel] : [model];
  if (cfgKey === 'semi_mhi' && model.indexOf('+') !== -1) {
    const bits = model.split('+').map(function (b) { return b.trim(); }).filter(Boolean);
    if (bits.length) return bits;
  }
  return [model];
}

/* Заголовок: один рядок, без переносів; розмір шрифту підганяє psFit(). */
function psTitleHtml(parts) {
  return parts.map(escapeHtml).join(' / ');
}

function psBrandName(cfgKey) {
  if (/_mhi$/.test(cfgKey)) return 'Mitsubishi Heavy Industries';
  if (/_gal$/.test(cfgKey)) return 'Galactic';
  return '';
}

/* ---------- Складання панелі ---------- */

function findPriceItem(cfgKey, model) {
  const list = (sheetsData && sheetsData[cfgKey]) || [];
  return list.find(function (it) { return it.model === model; }) || null;
}

function psTabBody() {
  const s = psState;
  /* Наявність — вкладка поруч із «Характеристиками» (рішення власника 2026-10-09).
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
  /* Функції й аксесуари існують лише для моделей, що є в каталозі MHI. */
  if (s.tab === 'funcs') return s.cat ? catFuncsHtml(s.cat) : '<div class="ps-empty">Немає даних.</div>';
  if (s.tab === 'acc') return s.cat ? catAccHtml(s.cat) : '<div class="ps-empty">Немає даних.</div>';
  /* Фото картки — над характеристиками (прохання власника 2026-10-09). */
  if (s.cat) return psPhotoHtml() + catSpecsHtml(s.cat);
  if (s.catPending) return psPhotoHtml() + '<div class="ps-loading">Завантажуємо характеристики…</div>';
  if (s.specs === undefined) return psPhotoHtml() + '<div class="ps-loading">Завантажуємо характеристики…</div>';
  /* Збій мережі — це НЕ «характеристик немає». Кажемо прямо й даємо повторити:
     файл лежить поруч із застосунком, друга спроба після повернення мережі
     майже завжди проходить (2026-10-19). */
  if (s.specsFailed) {
    return psPhotoHtml() +
      '<div class="ps-empty">Не вдалося завантажити характеристики — схоже, немає звʼязку.' +
      '<br><button type="button" class="ps-retry-btn" data-ps-specs-retry>Спробувати ще раз</button></div>';
  }
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
  /* Вкладка: ІКОНКА НАД ПІДПИСОМ, у рамці (макет власника 2026-10-12; 2026-10-19 власник
     підтвердив рамки й іконки для всіх вкладок панелі). */
  const tab = function (id, label, icon) {
    return '<button type="button" class="ps-tab' + (s.tab === id ? ' on' : '') + '" data-ps-tab="' + id + '">' +
      ic(icon, '') + '<span>' + label + '</span></button>';
  };
  /* Рядок під заголовком: бренд ліворуч, «На сайт ↗» праворуч. Посилання стоїть НИЖЧЕ
     хрестика (між ними шапка з нижньою межею й відступи), а не поруч із ним — власник
     просив, щоб пальцем не зачепити «закрити» замість «На сайт» і навпаки. */
  const brand = psBrandName(s.cfgKey);
  body.innerHTML =
    '<div class="ps-subrow"><span class="ps-brand">' + escapeHtml(brand) + '</span>' +
      (s.siteUrl
        ? '<a class="ps-site-btn" href="' + escapeHtml(s.siteUrl) + '" target="_blank" rel="noopener">' +
          '<span>На сайт</span>' + ic('external-link', '↗') + '</a>'
        : '') +
    '</div>' +
    psHeroHtml() +
    /* Підписи короткі: чотири вкладки ділять ширину порівну, і на екрані 360 px
       «Характеристики» обрізалось би многоточием (рішення власника 2026-10-19). */
    '<div class="ps-tabs">' + tab('specs', s.cat ? 'Тех. дані' : 'Характеристики', 'file-text') +
      (s.cat && catFunctions(s.cat).length ? tab('funcs', 'Функції', 'activity') : '') +
      (s.cat && (s.cat.series.accessories || []).length ? tab('acc', 'Аксесуари', 'wrench') : '') +
      (psHasStock() ? tab('stock', 'Наявність', 'package') : '') +
    '</div>' +
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
    /* знижка відсотком — єдина дія розрахунку; живе в шапці панелі */
    disc: NaN,
    tab: 'specs',   // «Розрахунку» вкладкою більше немає — він у шапці
    specs: undefined, slug: slug || null, img: cardImageUrl(slug),
    /* cat — дані з каталогу MHI; catPending — ще вантажиться файл каталогу */
    cat: null, catPending: false,
    stockParts: stockParts,
    siteUrl: slug ? ((siteLinks.base || 'https://sun-ice.com.ua/') + slug) : null
  };

  document.getElementById('product-sheet-title').innerHTML = psTitleHtml(psMarkings(cfgKey, it));
  psRender();
  document.getElementById('product-sheet-overlay').classList.add('show');
  psFitAll();
  /* шрифти могли дозавантажитись після першого виміру — підганяємо ще раз */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (psState) psFitAll(); });
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

  /* Каталог MHI — лише для розділів MHI. Файл один на всі серії, тому
     вантажимо раз і далі беремо з пам'яті. Поки не приїхав — показуємо
     «Завантажуємо…», а не дані сайту: інакше при кожному відкритті картки
     вміст встигав би моргнути з сайтового на каталожний. */
  if (/_mhi$/.test(cfgKey) && !mhiCatalogFailed) {
    psState.cat = mhiCatalogHit(cfgKey, it);
    if (!mhiCatalog) {
      psState.catPending = true;
      loadMhiCatalog().then(function () {
        if (!psState || psState.model !== model) return;
        psState.catPending = false;
        psState.cat = mhiCatalogHit(cfgKey, it);
        psRender();
        psFitAll();
      });
    }
  }

  if (!SPECS_FILES[cfgKey]) {
    psState.specs = null;
    if (psState.tab === 'specs') psRenderTabBody();
    return;
  }
  psLoadSpecsInto(cfgKey, slug, model);
}

/* Вантажимо характеристики в ПОТОЧНУ панель. Окремою функцією, бо те саме робить
   кнопка «Спробувати ще раз»: при збої loadSpecs() повертає null (а не порожній
   об'єкт), і ми відрізняємо «сервер сказав, що даних немає» від «не докричались». */
function psLoadSpecsInto(cfgKey, slug, model) {
  psState.specs = undefined;          // стан «завантажуємо…»
  psState.specsFailed = false;
  psState.specsKey = cfgKey;
  psState.specsSlug = slug;
  if (psState.tab === 'specs') psRenderTabBody();
  loadSpecs(cfgKey).then(function (all) {
    if (!psState || psState.model !== model) return;   // встигли відкрити інший товар
    if (all === null) { psState.specs = null; psState.specsFailed = true; }
    else { psState.specs = slug ? (all[slug] || null) : null; psState.specsFailed = false; }
    if (psState.tab === 'specs') psRenderTabBody();
  });
}

function psRetrySpecs() {
  if (!psState || !psState.specsKey) return;
  psLoadSpecsInto(psState.specsKey, psState.specsSlug, psState.model);
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
