/* Sun-ice — Парсери прайсу (всі розділи) + кеш прайсу
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Допоміжні функції парсингу прайсу ---------- */
const priceKeywordGroups = [
  ['ціна дилер', 'цена дилер', 'dealer price'],
  ['роздрібна ціна', 'розничная цена', 'retail price'],
  ['ціна', 'цена', 'price', 'стоимость']
];
const modelKeywords = ['модель', 'маркировка', 'маркування', 'артикул', 'sku', 'model', 'найменування', 'наименование'];
const internalKeywords = ['внутрішній', 'внутренний', 'indoor'];
const externalKeywords = ['зовнішній', 'наружный', 'outdoor'];
const unitTypeKeywords = ['тип блоку', 'тип блока'];
const blockNameKeywords = ['найменування блоку', 'наименование блока'];
const totalSubKeywords = ['комплект', 'всього', 'разом', 'итого', 'total'];
const categoryStems = ['настінн', 'стельов', 'касетн', 'канальн', 'колонн', 'підлогов', 'підвісн', 'шафов'];
// Насичені "ювелірні" тони для тонкої кольорової позначки серії (ліва смужка рядка +
// нижня лінія заголовка сегмента) — навмисно НЕ пастельні заливки фону рядка (як було раніше):
// суцільна заливка кольором виглядала по-дитячому яскраво, тонка смужка на білому тлі —
// стримано і "дорого", але зберігає ту саму функцію швидкого візуального розрізнення серій.
/* Кольори-маркери серій у прайсі (смуги по боках рядка + лінія під підписом серії).
   2026-09-18: були насичені "веб"-кольори (синій/зелений/фіолетовий...) — у теплій
   приглушеній палітрі дизайн-системи вони виглядали чужорідно. Замінені на приглушену
   теплу гаму (ember/сажа/сейдж/клей/амбер/бронза/хвоя/слива). Сама механіка (колір на
   серію) лишилась — вона допомагає бачити межі серій при прокрутці; у макеті
   дизайн-системи смуг немає взагалі, тож якщо захочеться "як у макеті" — достатньо
   віддати тут один колір на всі серії. */
const PALETTE = ['#C85A1C', '#7C6A55', '#6B9E7F', '#A8432F', '#9A7326', '#8B6A3F', '#46685F', '#7A6E86'];

function norm(v) { return String(v == null ? '' : v).toLowerCase().trim(); }
/* Пошук у Systemair/Повітряні завіси: не має значення, чи введено маркування з пробілами
   чи без ("K100M" = "K 100 M"), і не має значення, чи забули перемкнути розкладку на
   англійську — користувач читає код (напр. "K315L") і тисне кириличні літери, що
   ВИГЛЯДАЮТЬ як потрібні латинські (кирилична "к" на очах як "K" тощо), а не ту
   кирилицю, що технічно сидить на тій самій фізичній клавіші QWERTY (перша спроба такого
   мапування була саме за позицією клавіші — не спрацювало на практиці: "к31" не знаходив
   "K315L", бо йшло в "r31"). Для частини літер візуальна і фонетична відповідність
   розходяться (кирилична "р" виглядає як "P", але звучить як "R") — для них у мапі
   ОБИДВА варіанти, пошук пробує кожен через символьний клас регулярного виразу, а не
   лише один. Однакова мапа для рос. і укр. розкладок (спільні літери). */
const CYRILLIC_TO_LATIN_VARIANTS = {
  'а':'a', 'е':'e', 'к':'k', 'м':'m', 'о':'o', 'т':'t', 'і':'i', 'х':'x',
  'в':'bv', 'н':'hn', 'р':'pr', 'с':'cs', 'у':'yu',
  'й':'i', 'ц':'c', 'ш':'sh', 'щ':'sch', 'з':'z', 'ї':'i', 'ф':'f', 'п':'p', 'л':'l', 'д':'d',
  'ж':'zh', 'є':'e', 'я':'ya', 'ч':'ch', 'ю':'yu', 'и':'y', 'б':'b', 'ь':'', 'ъ':'', 'ы':'y',
  'э':'e', 'ё':'e', 'г':'g', 'ґ':'g'
};
function normalizeSearchKey(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
}
/* Перетворює введений користувачем пошуковий рядок на джерело регулярного виразу:
   кожна неоднозначна кирилична літера ("р","с","в","н","у") стає символьним класом
   з обома латинськими варіантами, решта символів (цифри, латиниця, однозначна кирилиця)
   — як є, з екрануванням спецсимволів регулярних виразів. */
function buildSearchPattern(query) {
  const cleaned = normalizeSearchKey(query);
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(/[а-яіїєґ]/g, ch => {
    const variants = CYRILLIC_TO_LATIN_VARIANTS[ch] || '';
    if (!variants) return '';
    return variants.length > 1 ? '[' + variants + ']' : variants;
  });
}
function matchesSearchQuery(target, query) {
  const pattern = buildSearchPattern(query);
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(normalizeSearchKey(target));
  } catch (e) {
    return normalizeSearchKey(target).includes(normalizeSearchKey(query));
  }
}
function cellContainsAny(v, keywords) {
  const s = norm(v);
  if (!s) return false;
  return keywords.some(k => s.includes(k));
}
function parseNumber(val) {
  if (typeof val === 'number') return isFinite(val) ? val : null;
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const cleaned = s.replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
function detectCurrency(headerText) {
  const s = norm(headerText);
  if (s.includes('грн')) return 'грн';
  if (s.includes('у.е') || s.includes('$')) return '$';
  if (s.includes('₴')) return '₴';
  return '';
}
function findPriceHeader(rows) {
  for (const group of priceKeywordGroups) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (cellContainsAny(row[c], group)) return { row: r, col: c, text: row[c] };
      }
    }
  }
  return null;
}
function findColumnInRow(row, keywords) {
  if (!row) return -1;
  for (let c = 0; c < row.length; c++) {
    if (cellContainsAny(row[c], keywords)) return c;
  }
  return -1;
}
function extractSeries(model) {
  if (!model) return null;
  const first = model.split(/[\s+]/)[0];
  const m = first.match(/^[A-ZА-ЯІЇЄ]+-?(\d+)([A-ZА-ЯІЇЄ]+)/i);
  return m ? m[2].toUpperCase() : null;
}
function isCategoryLabel(text) {
  const s = norm(text);
  if (!s) return false;
  return categoryStems.some(stem => s.includes(stem));
}
/* Екранування тексту, який підставляється в розмітку.
   ВАЖЛИВО про лапки: textContent→innerHTML екранує лише & < >, але НЕ лапки. А результат
   цієї функції підставляється не тільки між тегами, а й УСЕРЕДИНУ атрибутів
   (value="...", data-sku="...", aria-label="..."). Тому до 2026-09-21 будь-яка подвійна
   лапка у введеному тексті розривала атрибут і ламала верстку — наприклад пошук по
   запиту 15" у Systemair. Додано явну заміну лапок; без неї сама лише зачистка вводу
   (stripQuotes нижче) не рятує, бо в атрибути потрапляє ще й текст із прайсу. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Зачистка того, що вводить користувач: лапки прибираємо відразу при введенні, щоб вони
   не потрапляли ні в базу, ні в розмітку. Домовленість із користувачем 2026-09-21:
   "якщо стерти лапки, то все ж добре — хай вводить нормальні символи". */
function stripQuotes(str) {
  return String(str == null ? '' : str).replace(/["'«»„“”‘’]/g, '');
}
function parseSheet(rows, highlightMode, opts) {
  opts = opts || {};
  const seriesLabelMode = opts.seriesLabelMode || null; // 'first-sentence' (GALACTIC)
  const labelMap = opts.labelSequence
    ? new Map(opts.labelSequence.map(e => [e.fromModel, e]))
    : null; // ручний список підписів серій за кодом моделі (MHI, див. SPLIT_MHI_LABELS) —
             // мапить на весь запис {label, note?}, не лише на текст підпису.

  const priceHeader = findPriceHeader(rows);
  if (!priceHeader) return { items: [], error: 'Не знайдено колонку з ціною' };

  let priceCol = priceHeader.col;
  let dataStart = priceHeader.row + 1;
  const nextRow = rows[priceHeader.row + 1];
  if (nextRow) {
    for (let c = priceCol; c < nextRow.length; c++) {
      if (cellContainsAny(nextRow[c], totalSubKeywords)) {
        priceCol = c;
        dataStart = priceHeader.row + 2;
        break;
      }
    }
  }

  const headerRow = rows[priceHeader.row] || [];
  const headerRowAbove = rows[priceHeader.row - 1] || [];
  let modelCol = findColumnInRow(headerRow, modelKeywords);
  if (modelCol === -1) modelCol = findColumnInRow(headerRowAbove, modelKeywords);

  const internalCol = findColumnInRow(headerRow, internalKeywords);
  const externalCol = findColumnInRow(headerRow, externalKeywords);
  const unitTypeCol = findColumnInRow(headerRow, unitTypeKeywords);
  // НАЙМЕНУВАННЯ БЛОКУ — лише поряд із ТИП БЛОКУ (Мульти спліт-системи MHI/GALACTIC).
  // ПРОДУКТИВНІСТЬ для внутрішніх блоків (охолодження/нагрів) читаємо позиційно —
  // два стовпчики одразу після НАЙМЕНУВАННЯ БЛОКУ — бо окремого стійкого заголовка
  // в прайсі під це немає (там просто "Охолодження, кВт"/"Нагрів, кВт" в підрядку).
  const blockNameCol = unitTypeCol !== -1 ? findColumnInRow(headerRow, blockNameKeywords) : -1;
  const currency = detectCurrency(priceHeader.text);
  const items = [];
  // rowGroupMap[r] — "ефективний" підпис серії/категорії, що діяв на рядку r аркуша (той
  // самий effectiveKey, що йде в segment-header). Потрібен лише для прив'язки вбудованих
  // у Excel картинок серій до правильної групи (extractSeriesImages) — сам рендер прайсу
  // цим не користується. Для MHI (labelMap) підпис "спрацьовує" аж на рядку моделі, що
  // збігається з ключем SPLIT_MHI_LABELS, а не на рядку опису серії над ним, тому картинка,
  // яка в Excel стоїть НАД моделями (на рядку опису), лишалась би без пари — backward-fill
  // нижче після цикла закриває цей розрив, підтягуючи підпис ІЗ наступного визначеного
  // рядка назад.
  const rowGroupMap = [];
  let currentCategory = null;
  let currentSeriesLabel = null;
  let currentGroupNote = null; // SPLIT_MHI_LABELS[].note — статична примітка під заголовком
  // групи ЗАМІСТЬ спливаючого опису/фото (не разом із ним): коли задана, groupFullText
  // нижче примусово обнуляється для всіх рядків цієї групи.
  let currentFullText = null; // повний опис серії з прайсу — для спливаючого вікна "детальніше"
  // Для секцій "Зовнішні/Внутрішні блоки" (Мульти спліт-системи): порівнюємо тільки з
  // ПОПЕРЕДНІМ реальним зовніш./внутр. рядком, ігноруючи проміжні рядки-аксесуари
  // (пульти/адаптери — тип блоку не "зовніш."/"внутр.") — інакше заголовок секції
  // помилково повторювався б щоразу після такого рядка.
  let lastRealUnitType = null;

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const price = parseNumber(row[priceCol]);

    if (price === null && highlightMode === 'category' && modelCol !== -1) {
      const labelText = String(row[modelCol] || '').trim();
      const hasInternal = internalCol !== -1 && row[internalCol];
      const hasExternal = externalCol !== -1 && row[externalCol];
      if (labelText && !hasInternal && !hasExternal && isCategoryLabel(labelText)) {
        currentCategory = labelText;
      }
    }

    if (price === null && highlightMode === 'series' && modelCol !== -1) {
      const cellText = String(row[modelCol] || '').trim();
      if (seriesLabelMode === 'first-sentence' && cellText.includes('.')) {
        // Рядок-опис серії (GALACTIC): весь текст жирний, беремо перше речення до крапки
        // для короткого підпису, а весь текст рядка зберігаємо для вікна "детальніше".
        const firstSentence = cellText.split('.', 1)[0].trim();
        if (firstSentence.length > 12) {
          currentSeriesLabel = firstSentence + '.';
          currentFullText = cellText;
        }
      } else if (labelMap && cellText.length > 8) {
        // MHI: короткий підпис — за ручним списком SPLIT_MHI_LABELS (нижче), а повний
        // текст опису серії беремо як є з цього рядка прайсу (без жодної обробки) —
        // саме він піде у спливаюче вікно "детальніше".
        currentFullText = cellText;
      }
    }

    if (price === null) continue;

    let model = modelCol !== -1 ? String(row[modelCol] || '').trim() : '';
    if (!model && internalCol !== -1) {
      const parts = [row[internalCol], row[externalCol]].filter(v => v && String(v).trim());
      model = parts.map(v => String(v).trim()).join(' + ');
    }
    if (!model) continue;

    // MHI (ПОБУТОВІ): підпис серії — за ручним списком SPLIT_MHI_LABELS, прив'язаним
    // до конкретного коду моделі, з якого починається серія/під-група.
    if (labelMap && labelMap.has(model)) {
      const labelEntry = labelMap.get(model);
      currentSeriesLabel = labelEntry.label;
      currentGroupNote = labelEntry.note || null;
    }

    const item = { model, price, currency };
    if (highlightMode === 'series') {
      item.groupKey = extractSeries(model);
      if (seriesLabelMode || labelMap) {
        item.groupLabel = currentSeriesLabel || null;
        item.groupNote = currentGroupNote || null;
        // Група з note (SPLIT_MHI_LABELS) — статична примітка ЗАМІНЮЄ спливаючий опис/фото,
        // а не доповнює їх, тому груповий повний текст з Excel тут навмисно ігнорується.
        item.groupFullText = currentGroupNote ? null : (currentFullText || null);
      }
    } else if (highlightMode === 'category') item.groupKey = currentCategory;
    // Тип блоку (зовнішній/внутрішній) — потрібен для конфігуратора мультисплітів.
    // УВАГА: колонка "ТИП БЛОКУ" є не лише в МУЛЬТИСИСТЕМИ/GALACTIC, а й у ПОБУТОВІ
    // (Спліт-системи MHI) — з'ясувалось під час перевірки живими даними, старий
    // коментар про "лише мультисистеми" був неточним. Тому unitTypeCol !== -1 сам
    // по собі НЕ означає "це екран Мульти спліт-систем" — усе, що нижче в цьому
    // блоці (заголовки секцій, groupKey за типажем, продуктивність), додатково
    // гейтиться через opts.multisplitSections, який виставлено тільки в конфігу
    // плитки "Мульти спліт-системи" (CATALOG_TILES) — і Спліт-системи це не чіпає.
    if (unitTypeCol !== -1) {
      const typeText = norm(row[unitTypeCol]);
      if (typeText.includes('зовніш') || typeText.includes('наруж')) item.unitType = 'outdoor';
      else if (typeText.includes('внутр')) item.unitType = 'indoor';
      else item.unitType = null;
    }

    if (unitTypeCol !== -1 && opts.multisplitSections) {
      // Заголовок секції "Зовнішні блоки"/"Внутрішні блоки" — тільки в момент, коли
      // реальний тип справді змінився (рядки-аксесуари з unitType===null пропускаємо,
      // не рахуємо і не скидаємо lastRealUnitType — див. коментар вище).
      if (item.unitType && item.unitType !== lastRealUnitType) {
        item.sectionLabel = item.unitType === 'outdoor' ? 'Зовнішні блоки' : 'Внутрішні блоки';
        lastRealUnitType = item.unitType;
      } else {
        item.sectionLabel = null;
      }

      // НАЙМЕНУВАННЯ БЛОКУ ("Настінний"/"Касетний"/...) стає groupKey замість
      // серійного extractSeries(model) для цього прайсу — воно змістовніше і саме
      // його просив показувати як підзаголовок для внутрішніх блоків. Але тільки
      // коли opts.blockGrouping (наразі — лише MHI): для GAL просили показати ЛИШЕ
      // заголовки секцій (sectionLabel вище), без підгрупування — тому groupKey там
      // завжди null, "старий" серійний groupKey теж свідомо не лишаємо (замінили
      // на "нічого", а не повернули extractSeries). Для зовнішніх блоків підзаголовка
      // не показуємо в обох брендах (там лише один спільний заголовок секції).
      const blockName = blockNameCol !== -1 ? String(row[blockNameCol] || '').trim() : '';
      item.blockName = blockName || null;
      item.groupKey = (opts.blockGrouping && item.unitType === 'indoor') ? (blockName || null) : null;
    }
    // Напівпромислові Galactic (Galactic LCAC): той самий внутрішній блок стоїть у прайсі
    // кількома рядками — з різним зовнішнім (1 фаза/3 фази, звичайний/«7») і різною ціною.
    // Сам зовнішній блок — у першому наступному рядку БЕЗ ціни з типом "зовніш." (між ними
    // може бути рядок панелі). Без нього не відрізнити ці рядки, а від цього залежить, на
    // яку картку сайту веде тап (див. SITE_LINKS_FILE); тому читаємо його вперед.
    if (opts.pairOutdoor && unitTypeCol !== -1 && modelCol !== -1) {
      for (let k = r + 1; k < rows.length && k <= r + 3; k++) {
        const nextRow = rows[k] || [];
        if (parseNumber(nextRow[priceCol]) !== null) break; // уже наступний товар
        if (norm(nextRow[unitTypeCol]).includes('зовніш')) {
          item.outdoorModel = String(nextRow[modelCol] || '').trim() || null;
          break;
        }
      }
    }
    // Спліт-системи (MHI «ПОБУТОВІ», GAL): під рядком «внутр.» у прайсі йде рядок «зовніш.» з маркуванням у колонці
    // НАЙМЕНУВАННЯ БЛОКУ (колонка МОДЕЛЬ там порожня). Потрібно для залишків з 1С (stock.js): наявність і внутрішнього,
    // і зовнішнього блока. Поле навмисно НЕ outdoorModel — його читає siteLinkKey() і зламав би посилання на сайт.
    // Кольорові варіанти (-WT/-WB) зовнішнього рядка не мають — stock.js бере зовнішній «брата» з тією ж основою.
    if (opts.pairSplitOutdoor && unitTypeCol !== -1 && item.unitType === 'indoor') {
      for (let k = r + 1; k < rows.length && k <= r + 3; k++) {
        const nextRow = rows[k] || [];
        if (parseNumber(nextRow[priceCol]) !== null) break; // уже наступний товар
        if (norm(nextRow[unitTypeCol]).includes('зовніш')) {
          const outName = String((modelCol !== -1 && nextRow[modelCol]) || (blockNameCol !== -1 && nextRow[blockNameCol]) || '').trim();
          item.splitOutdoor = outName || null;
          break;
        }
      }
    }
    if (highlightMode === 'series') rowGroupMap[r] = item.groupLabel || item.groupKey || undefined;
    else if (highlightMode === 'category') rowGroupMap[r] = item.groupKey || undefined;
    items.push(item);
  }
  // Backward-fill: рядок опису серії йде ФІЗИЧНО НАД своїми моделями, але для MHI підпис
  // (currentSeriesLabel) виставляється лише на рядку моделі — тому "тягнемо" визначений
  // підпис назад на попередні ще не визначені рядки (картинка, вбудована в Excel над
  // моделями, потрапляє саме в цей розрив).
  for (let r = rows.length - 2; r >= dataStart; r--) {
    if (rowGroupMap[r] === undefined && rowGroupMap[r + 1] !== undefined) rowGroupMap[r] = rowGroupMap[r + 1];
  }

  if (highlightMode) {
    const colorMap = new Map();
    items.forEach(it => {
      if (!it.groupKey) return;
      if (!colorMap.has(it.groupKey)) colorMap.set(it.groupKey, PALETTE[colorMap.size % PALETTE.length]);
      it.color = colorMap.get(it.groupKey);
    });
  }

  return { items, error: items.length === 0 ? 'Не знайдено рядків з маркуванням і ціною' : null, rowGroupMap };
}

function sliceBySplitMarker(rows, marker, side) {
  const idx = rows.findIndex(row => (row || []).some(cell => norm(cell).includes(marker)));
  if (idx === -1) return rows; // маркер не знайдено — повертаємо все як є
  return side === 'after' ? rows.slice(idx) : rows.slice(0, idx);
}

/* Розфарбовує items за groupKey тим самим PALETTE, що й parseSheet() — окрема функція для
   кастомних парсерів нижче (Теплові насоси/VRF), щоб не чіпати вже перевірений parseSheet. */
function assignGroupColors(items) {
  const colorMap = new Map();
  items.forEach(it => {
    if (!it.groupKey) return;
    if (!colorMap.has(it.groupKey)) colorMap.set(it.groupKey, PALETTE[colorMap.size % PALETTE.length]);
    it.color = colorMap.get(it.groupKey);
  });
  return items;
}

function sheetRows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

/* ---------- "Теплові насоси" — MHI: комплекти "все-в-одному" ----------
   Структура аркуша "Теплові насоси" нестандартна (не флоу ціна/модель, а вкладені
   комплекти): "Комплект "X"" (заголовок групи) → "• опис підгрупи" (не завжди) → рядок-опис
   насоса (стовпчик C, зелений у прайсі — тут детектуємо як "є текст у C, але немає ні D, ні
   ціни") → 1+ рядків компонентів (C=модель, D=опис, E=ціна) → рядок "Разом" (C="Разом",
   E=підсумкова ціна). Далі в файлі є розділ "АКСЕСУАРИ" (B="АКСЕСУАРИ") — плоский список
   (B=модель, C=опис, E=ціна), без "Разом". Модель товару в застосунку = сам опис насоса
   (моделі окремих компонентів комплекту в назву не виносимо — їх видно у "детальніше"). */
function parseHeatpumpsMhiSheet(wb) {
  const rows = sheetRows(wb, 'ТН MHI Hydrolution');
  if (!rows) return [];
  // Аркуш без колонки A (у файлі вона порожня по всій вкладці) — SheetJS обрізає діапазон
  // до першої фактично використаної колонки, тому позиції стовпчиків "Комплект/Найменування/
  // Опис/Роздрібна ціна" зсуваються. Визначаємо їх динамічно через той самий заголовок
  // "Роздрібна ціна", яким користується звичайний parseSheet() — так само знаходить його
  // findPriceHeader(), — а не хардкодимо номери стовпчиків.
  const priceHeader = findPriceHeader(rows);
  const priceCol = priceHeader ? priceHeader.col : 4;
  const bCol = priceCol - 3;  // "Комплект .../• підгрупа"
  const cCol = priceCol - 2;  // "Найменування" (опис насоса / модель аксесуара)
  const dCol = priceCol - 1;  // "Опис" (компонент комплекту / опис аксесуара)

  const items = [];
  let kitCategory = null;
  let kitSubgroup = null;
  let inAccessories = false;
  let current = null; // { description, components: [] }

  function finalizeKit(total) {
    if (!current) return;
    const lines = [];
    if (kitSubgroup) { lines.push(kitSubgroup.replace(/\n/g, ' '), ''); }
    lines.push('Склад комплекту:');
    current.components.forEach(c => {
      lines.push('• ' + c.model + (c.desc ? ' — ' + c.desc.replace(/\n/g, ' ') : '') + ' — ' + Math.round(c.price).toLocaleString('uk-UA') + ' у.е.');
    });
    lines.push('', 'Разом: ' + Math.round(total).toLocaleString('uk-UA') + ' у.е.');
    items.push({
      model: current.description,
      price: total,
      currency: '$',
      groupKey: kitCategory,
      groupLabel: kitCategory,
      breakdownText: lines.join('\n'),
      /* Цей опис ("Склад комплекту") містить ціни компонентів і суму — тому його не
         можна показувати й зберігати тому, хто не має доступу до цін. Інші breakdownText
         (опис аксесуара нижче) цін не містять, там прапорця немає. */
      breakdownHasPrices: true
    });
    current = null;
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const b = String(row[bCol] || '').trim();
    const c = String(row[cCol] || '').trim();
    const d = String(row[dCol] || '').trim();
    const ePrice = parseNumber(row[priceCol]);

    if (b) {
      if (/^комплект/i.test(b)) { kitCategory = b; kitSubgroup = null; inAccessories = false; }
      else if (/^аксесуари/i.test(b)) { kitCategory = 'Аксесуари'; kitSubgroup = null; inAccessories = true; }
      else if (!inAccessories) { kitSubgroup = b; }
    }

    if (inAccessories) {
      if (b && !/^аксесуари/i.test(b) && ePrice !== null) {
        items.push({ model: b, price: ePrice, currency: '$', groupKey: kitCategory, groupLabel: kitCategory, breakdownText: c || null });
      }
      continue;
    }

    if (c && !d && ePrice === null) { current = { description: c, components: [] }; continue; }
    if (current && /^разом$/i.test(c) && ePrice !== null) { finalizeKit(ePrice); continue; }
    if (current && c && ePrice !== null) { current.components.push({ model: c, desc: d, price: ePrice }); }
  }
  return assignGroupColors(items);
}

/* ---------- "Теплові насоси" — HeatGuard ----------
   Простий список (без калькулятора й підбірки — ціна статична, за проханням користувача):
   МОДЕЛЬ (колонка A), потужність (колонка H), ціна в Євро (колонка I). Групуємо за рядками
   "Таблиця підбору ...". За проханням користувача поки що беремо лише основні таблиці
   (Micro/Hyper Inverter) — БЕЗ "каскад"-варіантів, безкорпусних версій і бака (окремий
   товар, не тепловий насос): відфільтровуємо по назві групи, а не по номеру рядка Excel —
   номер рядка користувач називав "на око" по гутеру Excel, і не збігається з індексом
   масиву, який повертає SheetJS (перші порожні рядки аркуша обрізаються). */
function parseHeatGuardSheet(wb) {
  const rows = sheetRows(wb, 'HeatGuard');
  if (!rows) return [];
  const items = [];
  let groupLabel = null;
  let skipGroup = false;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const a = String(row[0] || '').trim();
    if (!a) continue;
    if (/^таблиця підбору/i.test(a)) {
      groupLabel = a;
      skipGroup = /каскад|безкорпус|бака/i.test(a);
      continue;
    }
    if (skipGroup) continue;
    if (norm(a) === 'модель') continue;
    const powerRaw = String(row[7] || '').trim();
    const priceNum = parseNumber(row[8]);
    const isOnRequest = priceNum === null && norm(row[8]).includes('запит');
    if (!powerRaw && priceNum === null && !isOnRequest) continue;
    items.push({
      model: a, power: powerRaw ? powerRaw + ' кВт' : null, price: priceNum, currency: 'EUR', onRequest: isOnRequest,
      groupKey: groupLabel, groupLabel: groupLabel
    });
  }
  return assignGroupColors(items);
}

/* ---------- "Теплові насоси" — WineGuard ----------
   МОДЕЛЬ (колонка A), продуктивність у Вт (колонка H — умови вимірювання tвн.+10/tзов.+35°С
   не повторюємо в кожному рядку, а показуємо один раз дрібним підписом під заголовком секції,
   див. opts.headerNote у renderHeatpumpsList), роздрібна ціна у $ (колонка N). Групуємо за
   назвами секцій ("НАСТІННА КЛІМАТИЧНА СИСТЕМА.../КАНАЛЬНА..."). */
function parseWineGuardSheet(wb) {
  const rows = sheetRows(wb, 'WineGuard');
  if (!rows) return [];
  const items = [];
  let groupLabel = null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const a = String(row[0] || '').trim();
    if (!a) continue;
    if (norm(a) === 'модель') continue;
    const power = String(row[7] || '').trim();
    const priceNum = parseNumber(row[13]);
    if (!power || priceNum === null) {
      if (a.length > 10) groupLabel = a;
      continue;
    }
    items.push({
      model: a, power: power + ' Вт', price: priceNum, currency: '$',
      groupKey: groupLabel, groupLabel: groupLabel
    });
  }
  return assignGroupColors(items);
}

/* ---------- "Теплові насоси" — TH MHI EZY та Q-ton (нова плитка) ----------
   Два зональних формати колонок в одному аркуші: основне обладнання (зовнішні/внутрішні
   блоки) — B=маркування, C=опис, D=ціна, A=лише заголовок групи; баки/аксесуари/Q-ton —
   A=маркування, B=опис, D=ціна (C там не використовується). Той самий "зсув на одну
   колонку між основним обладнанням і плоским списком аксесуарів", що вже є у старому
   аркуші "ТН MHI Hydrolution" — тут просто ще одна пара таких зон (EZY + Q-ton).
   rowGroupMap кешується в thEzyRowGroupMapCache — для extractSeriesImages() (фото
   зовнішнього блока EZY R290 і внутрішніх блоків, вбудовані в Excel над відповідними
   рядками). */
// Групи, де діє "зсунутий" формат колонок (A=модель, B=опис) — визначається заголовком
// групи, а НЕ вмістом самого рядка (колонка B заповнена в ОБОХ форматах — і як опис у
// зсунутому, і як маркування в основному, тому судити по "чи є текст у B" не можна).
const TH_EZY_SHIFTED_HEADERS = ['баки для гарячої води', 'аксесуари', 'зовнішній блок q-ton co2'];
let thEzyRowGroupMapCache = null;
function parseThMhiEzyQtonSheet(wb) {
  const rows = sheetRows(wb, 'TH MHI – EZY та Qton');
  if (!rows) { thEzyRowGroupMapCache = []; return []; }
  const items = [];
  const rowGroupMap = [];
  let currentGroup = null;
  let isShifted = false;
  let accessoriesCount = 0; // "АКСЕСУАРИ" зустрічається двічі (EZY і окремо Q-ton) — розрізняємо в підписі
  for (let r = 8; r < rows.length; r++) {
    const row = rows[r] || [];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const colC = String(row[2] || '').trim();
    const price = parseNumber(row[3]);
    if (price === null) {
      if (colA) {
        isShifted = TH_EZY_SHIFTED_HEADERS.includes(norm(colA));
        currentGroup = norm(colA) === 'аксесуари'
          ? (++accessoriesCount === 1 ? 'АКСЕСУАРИ (EZY)' : 'АКСЕСУАРИ (Q-ton)')
          : colA;
      }
      continue; // заголовок групи (лише colA) або порожній/непарний рядок-продовження опису
    }
    const model = isShifted ? colA : colB;
    if (!model) continue; // "осиротілий" рядок з ціною другого варіанта без власної назви (обробляється нижче ЯК ЧАСТИНА попереднього рядка, тут сам по собі більше нічого не додає)
    // Рядок типу "EMK300M / EMK500M" чи "Anode T300/Anode T500" — одна назва об'єднує ДВА
    // окремих маркування, і в файлі під ним є ще один рядок-"сирота" з другою ціною без
    // власної назви. Незрозуміло, яка з двох цифр належить якому з двох маркувань у
    // назві — свідомо НЕ вгадуємо (напр. по порядку), а показуємо прочерк для обох.
    const nextRow = rows[r + 1] || [];
    const nextColA = String(nextRow[0] || '').trim();
    const nextColB = String(nextRow[1] || '').trim();
    const nextModel = isShifted ? nextColA : nextColB;
    const nextPrice = parseNumber(nextRow[3]);
    const ambiguous = !nextModel && nextPrice !== null;
    if (ambiguous) {
      items.push({ model, priceUnknown: true, currency: '$', groupKey: currentGroup, groupLabel: currentGroup });
    } else {
      items.push({ model, price, currency: '$', groupKey: currentGroup, groupLabel: currentGroup });
    }
    rowGroupMap[r] = currentGroup || undefined;
  }
  thEzyRowGroupMapCache = rowGroupMap;
  return assignGroupColors(items);
}
async function getThEzyRowGroupMap() {
  if (thEzyRowGroupMapCache) return thEzyRowGroupMapCache;
  const buf = await ensurePriceRawBuffer();
  if (!buf) return [];
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  parseThMhiEzyQtonSheet(wb); // побічний ефект — заповнює thEzyRowGroupMapCache
  return thEzyRowGroupMapCache || [];
}

/* ---------- "Вентиляційне обладнання" — Systemair ----------
   Аркуш ~14000 рядків (весь європейський каталог) — без групування, простий плоский
   список: Артикул (A), Назва (B), Роздрібна ціна EUR (D). Рендериться лише за пошуком
   (renderVentilationList) — 14000 DOM-рядків одразу заморозили б мобільний браузер. */
// articleLink: true — тап на артикул шукає товар за цим SKU через живий пошуковий API
// офіційного сайту Systemair і відкриває знайдену сторінку (openSystemairSkuPage) —
// тільки за ТОЧНИМ збігом номера, без здогадок, якщо не знайдено. Той самий сайт і той
// самий механізм, що й у "Повітряні завіси" (FRICO) — обидва каталоги належать Systemair.
function parseSystemairSheet(wb) {
  const rows = sheetRows(wb, 'SYSTEMAIR');
  if (!rows) return [];
  const items = [];
  for (let r = 8; r < rows.length; r++) {
    const row = rows[r] || [];
    const article = String(row[0] || '').trim();
    const model = String(row[1] || '').trim();
    const price = parseNumber(row[3]);
    if (!model || price === null) continue;
    items.push({ model, article, articleLink: true, price, currency: 'EUR' });
  }
  return items;
}

/* ---------- "Повітряні завіси" — FRICO ----------
   Назва (B) = маркування, Артикул (A), Роздрібна ціна EUR (D). */
function parseFricoSheet(wb) {
  const rows = sheetRows(wb, 'FRICO');
  if (!rows) return [];
  const items = [];
  for (let r = 8; r < rows.length; r++) {
    const row = rows[r] || [];
    const article = String(row[0] || '').trim();
    const model = String(row[1] || '').trim();
    const price = parseNumber(row[3]);
    if (!model || price === null) continue;
    items.push({ model, article, articleLink: true, price, currency: 'EUR' });
  }
  return items;
}
/* ---------- "Повітряні завіси" — REMAK (другий бренд, перемикач FRICO/REMAK) ----------
   Аркуш "REMAK ЗАВІСИ": кілька однакових таблиць підряд (C1/D2/P-6 серії), заголовок
   "Тип завіси"/"Модель" повторюється перед кожною — col0=група (об'єднана клітинка,
   переносимо вперед), col1=маркування, col3=ціна €. В кінці окрема секція "Приладдя" з
   ІНШИМ порядком колонок (col0=маркування, col1=опис) — той самий "зсув" між основною
   таблицею і плоским списком аксесуарів, що вже траплявся в інших аркушах цього прайсу. */
function parseRemakCurtainsSheet(wb) {
  const rows = sheetRows(wb, 'REMAK ЗАВІСИ');
  if (!rows) return [];
  const items = [];
  let currentGroup = null;
  let inAccessories = false;
  for (let r = 18; r < rows.length; r++) {
    const row = rows[r] || [];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const price = parseNumber(row[3]);
    const normA = norm(colA);
    if (normA === 'тип завіси' || normA === 'найменування') continue; // повторювані заголовки таблиць
    if (normA === 'приладдя') { inAccessories = true; currentGroup = 'Приладдя'; continue; }
    if (inAccessories) {
      if (!colA || price === null) continue;
      items.push({ model: colA, price, currency: 'EUR', groupKey: currentGroup, groupLabel: currentGroup });
    } else {
      if (colA) currentGroup = colA; // "Без обігріву"/"З електрообігрівом"/"З водяним обігрівом"
      if (!colB || price === null) continue;
      items.push({ model: colB, price, currency: 'EUR', groupKey: currentGroup, groupLabel: currentGroup });
    }
  }
  return assignGroupColors(items);
}
/* Відкриває картку товару на сайті Systemair за артикулом з прайсу.

   ДВІ ПОЛАГОДЖЕНІ БІДИ (2026-09-21), через які тап по артикулу часто "нічого не робив":

   1) ВІКНО ВІДКРИВАЛОСЬ ЗАПІЗНО. Було: спершу await fetch до сайту, і лише ПОТІМ
      window.open. Браузер дозволяє відкрити вкладку тільки безпосередньо в момент
      дотику; через 300–800 мс після відповіді сервера він вважає це спливаючим вікном
      і ГАСИТЬ МОВЧКИ, без помилки в консолі. На iPhone і у встановленому застосунку —
      особливо жорстко. Підтверджено користувачем: тап по назві моделі (там window.open
      викликався синхронно — тоді це був пошук Google, тепер картка на сайті, див.
      .row-info[data-site-url]) відкриває сторінку нормально, а тап по артикулу не
      робив нічого.
      Тепер: порожня вкладка відкривається ПЕРШИМ рядком, ще до запиту, а вже потім їй
      підставляється знайдена адреса.

   2) НЕМА ТОЧНОГО ЗБІГУ — НЕ БУЛО НІЧОГО. Аркуш SYSTEMAIR — увесь європейський каталог,
      а сайт Systemair Україна лише його частина: на вибірці з 10 артикулів вентиляції
      2 не знаходились узагалі (напр. 2430, 16956 — їх нема в українському каталозі,
      перевірено і з discontinued=true). Старий код у такому разі просто виходив.
      Тепер: відкриваємо картку найближчого знайденого товару того ж сімейства
      (для 2430 це 2435 — та сама серія AR200, інший типорозмір) і чесно попереджаємо
      написом, що точного артикула не знайдено. Якщо не знайшлось нічого — вкладку
      закриваємо й кажемо про це, а не лишаємо порожню. */
function systemairProductUrl(u) {
  return String(u || '').replace(/^systemair-uk-ua\//, 'https://www.systemair.com/uk-ua/');
}
async function openSystemairSkuPage(sku) {
  // ПЕРШИМ ділом, поки ще діє "дозвіл від дотику" — інакше вкладку заблокують.
  const tab = window.open('', '_blank');
  try {
    const res = await fetch('https://www.systemair.com/api/uk-ua/search?id=93290740&query=' +
      encodeURIComponent(sku) + '&type=skus&discontinued=false&maxHits=20');
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const list = (data && data.skus) || [];
    const exact = list.find(s => String(s.number) === String(sku));
    const chosen = exact || list.find(s => s && s.url);

    if (!chosen || !chosen.url) {
      if (tab) tab.close();
      showHeaderToast('Артикул ' + sku + ' не знайдено на сайті Systemair', 2600);
      return;
    }
    const url = systemairProductUrl(chosen.url);
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    if (!exact) {
      showHeaderToast('Точного артикула ' + sku + ' немає на сайті — відкрито найближчий товар', 3200);
    }
  } catch (e) {
    // Сайт недоступний або немає інтернету. Порожню вкладку прибираємо за собою.
    if (tab) tab.close();
    showHeaderToast('Не вдалося звʼязатися з сайтом Systemair', 2600);
  }
}

/* ---------- "Мультизональні VRF" — MHI (3 вкладки прайсу, одна логіка) ----------
   Спільна форма для "VRF Зовнішні блоки", "VRF Внутрішні R410A" і "VRF Внутрішні
   KXZE1-W R32": модель завжди у стовпчику C, ціна завжди у стовпчику G. Рядок без ціни —
   заголовок серії/типажу (підпис бере з C, якщо є, інакше з B — так однаково працює і для
   "Зовнішніх блоків" (назва серії в B), і для "Внутрішніх" (назва типажу в C, короткий код
   у B)). */
// rowGroupMap для кожного з трьох VRF MHI аркушів (extractSeriesImages) — окремий кеш на
// sheetName, бо parseVrfTypeSheet() викликається тричі з різними аркушами/результатами.
let vrfRowGroupMapCache = {};
function parseVrfTypeSheet(wb, sheetName) {
  const rows = sheetRows(wb, sheetName);
  if (!rows) { vrfRowGroupMapCache[sheetName] = []; return []; }
  // Стовпчик "Тип блоку"/моделі завжди рівно на 4 позиції лівіше за стовпчик ціни (яку б
  // саме колонку не займала ціна у конкретному аркуші) — тому знаходимо ціну через
  // findPriceHeader() (як і generic parseSheet()) і рахуємо решту від неї, а не хардкодимо
  // номери стовпчиків: аркуш "VRF Зовнішні блоки" має колонку A використаною (модель у C),
  // а аркуші "VRF Внутрішні ..." — ні (SheetJS обрізає порожню колонку A, усе зсувається
  // на 1 вліво, модель опиняється у B) — офсет "модель − 4 = ціна" однаковий для обох форм.
  const priceHeader = findPriceHeader(rows);
  if (!priceHeader) { vrfRowGroupMapCache[sheetName] = []; return []; }
  const priceCol = priceHeader.col;
  const modelCol = priceCol - 4;
  const labelCol = modelCol - 1;
  if (modelCol < 0) { vrfRowGroupMapCache[sheetName] = []; return []; }
  const items = [];
  const rowGroupMap = [];
  let groupLabel = null;
  for (let r = priceHeader.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const b = String(row[labelCol] || '').trim();
    const c = String(row[modelCol] || '').trim();
    const price = parseNumber(row[priceCol]);
    if (price === null) {
      const label = c || b;
      if (label) groupLabel = label;
      continue;
    }
    if (!c) continue;
    items.push({ model: c, price: price, currency: '$', groupKey: groupLabel, groupLabel: groupLabel });
    rowGroupMap[r] = groupLabel || undefined;
  }
  vrfRowGroupMapCache[sheetName] = rowGroupMap;
  return assignGroupColors(items);
}
async function getVrfRowGroupMap(cacheKey, rebuildFn) {
  if (vrfRowGroupMapCache[cacheKey]) return vrfRowGroupMapCache[cacheKey];
  const buf = await ensurePriceRawBuffer();
  if (!buf) return [];
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  rebuildFn(wb); // побічний ефект — заповнює vrfRowGroupMapCache[cacheKey]
  return vrfRowGroupMapCache[cacheKey] || [];
}

/* ---------- "Мультизональні VRF" — GALACTIC ----------
   Один аркуш "Galactic VRF" містить і зовнішні, і внутрішні блоки (розділені банерами
   "Зовнішні блоки"/"Внутрішні блоки" у стовпчику A). Ціна завжди "За запитом" — кнопка веде
   на вкладку "Контакти" (без калькулятора й підбірки, як і просив користувач). */
function parseGalVrfOutdoorSheet(wb) {
  const rows = sheetRows(wb, 'Galactic VRF');
  if (!rows) { vrfRowGroupMapCache.galOutdoor = []; return []; }
  const items = [];
  const rowGroupMap = [];
  let groupLabel = null;
  let started = false;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!started) { if (norm(row[0]) === 'зовнішні блоки') started = true; continue; }
    if (norm(row[0]).startsWith('внутрішні блок')) break;
    const model = String(row[1] || '').trim();
    if (!model || norm(model) === 'модель') continue;
    const note = String(row[9] || '').trim();
    // "Все, що після цифри в моделі — це серія блоку" (напр. GUC-136Z-SR → серія Z-SR)
    const m = model.match(/^([A-ZА-ЯІЇЄ]+)-(\d+)(.+)$/i);
    if (m) groupLabel = m[1].toUpperCase() + ' ' + m[3].toUpperCase();
    else if (note) groupLabel = note.replace(/\n/g, ' ');
    items.push({
      model: model, price: null, currency: '', onRequest: true,
      groupKey: groupLabel, groupLabel: groupLabel, breakdownText: note || null
    });
    rowGroupMap[r] = groupLabel || undefined;
  }
  vrfRowGroupMapCache.galOutdoor = rowGroupMap;
  return assignGroupColors(items);
}
/* Обгортка для кастомних (не-generic) вкладок — та сама самодіагностика (price_issues),
   що вже є для звичайних CATALOG_TILES-вкладок нижче в buildSheetsData(), тепер і тут:
   раніше ці 8 джерел (теплові насоси MHI/HeatGuard/WineGuard, 5 VRF-джерел) були лише
   в try/catch, що мовчки повертав [] — перейменування вкладки в новому прайсі
   ("Теплові насоси" → "ТН MHI Hydrolution") пройшло непоміченим і самодіагностика
   показала "Проблем не виявлено", хоча дані зникли. */
function parseCustomTileSheet(wb, sheetName, tileLabel, brandTag, parseFn, problems, issues) {
  if (!wb.SheetNames.includes(sheetName)) {
    const msg = 'Вкладку "' + sheetName + '" не знайдено у файлі прайсу';
    problems.push(tileLabel + ' / ' + brandTag.toUpperCase() + ' (вкладку "' + sheetName + '" не знайдено у файлі)');
    issues.push({ tile: tileLabel, brand: brandTag, kind: 'error', message: msg });
    return [];
  }
  try {
    const items = parseFn(wb) || [];
    if (items.length === 0) {
      const msg = 'Не знайдено жодної позиції з ціною';
      problems.push(tileLabel + ' / ' + brandTag.toUpperCase() + ' (' + msg + ')');
      issues.push({ tile: tileLabel, brand: brandTag, kind: 'error', message: msg });
    }
    return items;
  } catch (e) {
    const msg = 'Помилка розбору: ' + e.message;
    problems.push(tileLabel + ' / ' + brandTag.toUpperCase() + ' (' + msg + ')');
    issues.push({ tile: tileLabel, brand: brandTag, kind: 'error', message: msg });
    return [];
  }
}
/* ---------- "Витратні матеріали" (аркуш "Витратні матеріали") ----------
   Аркуш — не одна таблиця, а кілька різних табличок підряд із власними заголовками
   колонок і об'єднаними клітинками, тому автопошук заголовка (findPriceHeader) тут не
   працює: беремо рівно ті рядки, які просив користувач, фіксованими вікнами.

   ВАЖЛИВО: на відміну від решти парсерів, читаємо за АДРЕСАМИ клітинок (B7, C7...), а
   не через sheetRows()/індекси масиву. Причина: діапазон цього аркуша — B1:F40, тобто
   він починається з колонки B, і sheet_to_json зсунув би всі колонки на одну вліво
   (B став би нульовим). Адресація літерами не залежить ні від цього зсуву, ні від
   того, чи з'явиться колись щось у колонці A, і збігається з тим, що видно в Excel.

   Свідомо НЕ беремо групу "ТРУБА та ТЕРМОІЗОЛЯТОР" (рядки 20-27) і позиції К-3/К-3n
   (рядки 9, 12) та MULTI ANTI-VIBRATION PAD (рядок 18) — їх користувач не включив.

   Ціни тут ДИЛЕРСЬКІ і в різних валютах у різних групах ($ на кронштейни, EUR на
   решту), тому валюта зберігається в кожній позиції окремо, а не одна на аркуш. */
const CONSUMABLE_ROWS = {
  // B=найменування, C=код, D=розміри, E=крок кріплення, F=ціна
  brackets:   { groupRow: 5,  rows: [7, 8, 10, 11], currency: '$' },
  // B=маркування, C=артикул, D=опис, F=ціна
  antivib:    { groupRow: 14, rows: [16, 17],       currency: 'EUR' },
  // назва (B) і ціна (F) — в першому рядку блоку (об'єднані клітинки), опис — нижче в B
  winterKits: { groupRow: 31, currency: 'EUR',
                blocks: [{ head: 32, desc: 34 }, { head: 37, desc: 39 }] }
};

/* "9" → "9", "1.58" → "1,58": копійки показуємо лише там, де вони справді є. */
function formatConsumablePrice(price, currency) {
  const num = Number.isInteger(price)
    ? price.toLocaleString('uk-UA')
    : price.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num + ' ' + currency;
}

function parseConsumablesSheet(wb) {
  const sheet = wb.Sheets['Витратні матеріали'];
  if (!sheet) return [];
  // Текст клітинки за адресою; у прайсі багато переносів рядка всередині клітинок.
  const raw = (col, row) => {
    const c = sheet[col + row];
    return c && c.v != null ? c.v : '';
  };
  const cell = (col, row) => String(raw(col, row)).replace(/\r\n/g, '\n').trim();
  // Для підрядка під назвою переноси не потрібні — там має бути один рядок.
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  const groupLabelAt = (row, fallback) => flat(cell('B', row)) || fallback;
  const items = [];

  // --- Кронштейни: B=назва+навантаження одним текстом, C=код, D=розміри, E=крок кріплення
  const br = CONSUMABLE_ROWS.brackets;
  const brGroup = groupLabelAt(br.groupRow, 'Опора під кондиціонер (КРОНШТЕЙНИ)');
  br.rows.forEach(r => {
    const full = cell('B', r);
    const price = parseNumber(raw('F', r));
    if (!full || price === null) return;
    // "Опора під кондиціонер К-1n (з нержавіючої сталі) Рекомендоване навантаження: 50 кг"
    // → маркування "К-1n (нерж.)", підрядок "50 кг · 430х350х50 мм". Повторювати
    // "Опора під кондиціонер" у кожному рядку не треба — це вже написано в заголовку групи.
    const code = (full.match(/К-\d+\s*n?/i) || [full])[0].replace(/\s+/g, '');
    const stainless = /нержавію/i.test(full);
    const load = (full.match(/навантаження:\s*([\d\s]+кг)/i) || [])[1];
    const size = flat(cell('D', r));
    const pitch = flat(cell('E', r));
    items.push({
      model: code + (stainless ? ' (нерж.)' : ''),
      power: [load && flat(load), size ? size + ' мм' : ''].filter(Boolean).join(' · '),
      article: cell('C', r),
      price, currency: br.currency,
      priceText: formatConsumablePrice(price, br.currency),
      groupKey: brGroup, groupLabel: brGroup,
      breakdownText: [
        flat(full),
        size ? 'Розміри (ДхВхШ): ' + size + ' мм' : '',
        pitch ? 'Відстань між кріпленням: ' + pitch.replace(/-{2,}/g, '–') + ' мм (є розширений паз)' : ''
      ].filter(Boolean).join('\n')
    });
  });

  // --- Антивібраційні опори: B=маркування (як у виробника), C=артикул, D=опис українською
  const av = CONSUMABLE_ROWS.antivib;
  const avGroup = groupLabelAt(av.groupRow, 'Антивібраційні опори');
  av.rows.forEach(r => {
    const model = flat(cell('B', r));
    const price = parseNumber(raw('F', r));
    if (!model || price === null) return;
    const desc = flat(cell('D', r));
    items.push({
      model,
      // З опису в підрядок іде лише уточнення в дужках ("ціна за 1 шт, в комплекті 4 шт.") —
      // саме те, що дилеру треба бачити біля ціни, щоб не порахувати комплект за штуку.
      power: (desc.match(/\(([^)]*)\)/) || [])[1] || '',
      article: cell('C', r),
      price, currency: av.currency,
      priceText: formatConsumablePrice(price, av.currency),
      groupKey: avGroup, groupLabel: avGroup,
      breakdownText: desc
    });
  });

  // --- Зимові комплекти: назва й ціна в об'єднаних клітинках, опис окремим рядком нижче
  const wk = CONSUMABLE_ROWS.winterKits;
  const wkGroup = groupLabelAt(wk.groupRow, 'Зимові комплекти');
  wk.blocks.forEach(b => {
    const model = flat(cell('B', b.head));
    const price = parseNumber(raw('F', b.head));
    if (!model || price === null) return;
    const rawDesc = cell('B', b.desc);
    // Код лежить у самому тексті опису — "(код Г8145)". Виносимо його в артикул, щоб
    // дилер бачив код окремо, а не шукав його в кінці абзацу.
    const codeInText = (rawDesc.match(/\(код\s+([^)]+)\)/i) || [])[1] || '';
    items.push({
      model,
      article: codeInText,
      price, currency: wk.currency,
      priceText: formatConsumablePrice(price, wk.currency),
      groupKey: wkGroup, groupLabel: wkGroup,
      breakdownText: rawDesc.replace(/\s*\(код\s+[^)]+\)/i, '').trim()
    });
  });

  return assignGroupColors(items);
}

/* Спільний список для buildSheetsData() (розбір) і reportPriceDiagnostics() (автогасіння
   виправлених проблем) — щоб не дублювати одні й ті самі tile/brand/sheet у двох місцях. */
const CUSTOM_SHEET_DIAG = [
  { key: 'heatpumps_mhi', sheet: 'ТН MHI Hydrolution', tile: 'Теплові насоси', brand: 'mhi', parse: parseHeatpumpsMhiSheet },
  { key: 'heatguard', sheet: 'HeatGuard', tile: 'Теплові насоси', brand: 'heatguard', parse: parseHeatGuardSheet },
  { key: 'wineguard', sheet: 'WineGuard', tile: 'Теплові насоси', brand: 'wineguard', parse: parseWineGuardSheet },
  { key: 'th_ezy_qton', sheet: 'TH MHI – EZY та Qton', tile: 'Теплові насоси', brand: 'ezyqton', parse: parseThMhiEzyQtonSheet },
  { key: 'vrf_mhi_outdoor', sheet: 'VRF Зовнішні блоки', tile: 'Мультизональні VRF', brand: 'mhi-outdoor', parse: wb => parseVrfTypeSheet(wb, 'VRF Зовнішні блоки') },
  { key: 'vrf_mhi_indoor_r410a', sheet: 'VRF Внутрішні R410A', tile: 'Мультизональні VRF', brand: 'mhi-indoor-r410a', parse: wb => parseVrfTypeSheet(wb, 'VRF Внутрішні R410A') },
  { key: 'vrf_mhi_indoor_kxze1w', sheet: 'VRF Внутрішні KXZE1-W R32', tile: 'Мультизональні VRF', brand: 'mhi-indoor-kxze1w', parse: wb => parseVrfTypeSheet(wb, 'VRF Внутрішні KXZE1-W R32') },
  { key: 'vrf_gal_outdoor', sheet: 'Galactic VRF', tile: 'Мультизональні VRF', brand: 'gal-outdoor', parse: parseGalVrfOutdoorSheet },
  { key: 'vrf_gal_indoor', sheet: 'Galactic VRF', tile: 'Мультизональні VRF', brand: 'gal-indoor', parse: parseGalVrfIndoorSheet },
  { key: 'kkb_gal', sheet: 'Galactic ККБ', tile: 'Компресорно-конденсаторні блоки (ККБ)', brand: 'gal', parse: parseKkbGalSheet },
  { key: 'kkb_mhi', sheet: 'ККБ MHI', tile: 'Компресорно-конденсаторні блоки (ККБ)', brand: 'mhi', parse: parseKkbMhiSheet },
  { key: 'systemair', sheet: 'SYSTEMAIR', tile: 'Вентиляційне обладнання', brand: 'systemair', parse: parseSystemairSheet },
  { key: 'frico', sheet: 'FRICO', tile: 'Повітряні завіси', brand: 'frico', parse: parseFricoSheet },
  { key: 'remak_curtains', sheet: 'REMAK ЗАВІСИ', tile: 'Повітряні завіси', brand: 'remak', parse: parseRemakCurtainsSheet },
  { key: 'consumables', sheet: 'Витратні матеріали', tile: 'Витратні матеріали', brand: 'consumables', parse: parseConsumablesSheet }
];
function parseGalVrfIndoorSheet(wb) {
  const rows = sheetRows(wb, 'Galactic VRF');
  if (!rows) { vrfRowGroupMapCache.galIndoor = []; return []; }
  const items = [];
  const rowGroupMap = [];
  let groupLabel = null;
  let started = false;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!started) { if (norm(row[0]).startsWith('внутрішні блок')) started = true; continue; }
    const model = String(row[1] || '').trim();
    const typeLabel = String(row[5] || '').trim();
    if (typeLabel) groupLabel = typeLabel;
    if (!model || norm(model) === 'модель') continue;
    const note = String(row[7] || '').trim();
    items.push({
      model: model, price: null, currency: '', onRequest: true,
      groupKey: groupLabel, groupLabel: groupLabel, breakdownText: note || null
    });
    rowGroupMap[r] = groupLabel || undefined;
  }
  vrfRowGroupMapCache.galIndoor = rowGroupMap;
  return assignGroupColors(items);
}

/* ---------- "Компресорно-конденсаторні блоки (ККБ)" ---------- */
// "Все, що в маркуванні одразу після цифри потужності — серія" (той самий прийом, що й
// parseGalVrfOutdoorSheet вище, напр. GUC-76Z-H → серія "Z-H").
function extractGucSeries(model) {
  const m = String(model).match(/^([A-ZА-ЯІЇЄ]+)-(\d+)(.+)$/i);
  return m ? m[3].toUpperCase().trim() : null;
}
function parseKkbGalSheet(wb) {
  const rows = sheetRows(wb, 'Galactic ККБ');
  if (!rows) return [];
  const description = String((rows[3] || [])[1] || '').trim(); // B4 — один опис на всі серії
  const items = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r] || [];
    const model = String(row[2] || '').trim(); // C — маркування
    if (!model) break; // далі "Належність"/AHU Kits — інша структура, нею не просили
    const cooling = row[4], heating = row[5]; // E/F — продуктивність, кВт
    const power = (cooling !== '' && cooling != null && heating !== '' && heating != null)
      ? String(cooling).replace('.', ',') + '/' + String(heating).replace('.', ',') + ' кВт' : '';
    const series = extractGucSeries(model);
    items.push({
      model, price: null, currency: '', onRequest: true, power,
      groupKey: series, groupLabel: series, groupFullText: description || null
    });
  }
  return assignGroupColors(items);
}
// Аркуш "ККБ MHI": лише перші два розділи (ККБ RAC інвертор / ККБ VRF інвертор, рядки 6-26
// у самому Excel, 0-based 5-25) — усі з ціною "За запитом", саме про них просив користувач.
// Далі в тому самому аркуші йде зовсім інша таблиця (EEV KIT з реальними цінами по кожній
// конкретній моделі внутр./зовн. блоку) — вона не про ККБ-серії й свідомо не береться.
// Колонка A — назва серії (Excel-merge на кілька рядків, тому в SheetJS порожня на всіх,
// крім першого рядка групи — переносимо вперед), колонка B — маркування, колонка F —
// "За запитом". Три "шапки" на всю ширину (лише колонка A, порожні B/F) — заголовки
// категорій (RAC / VRF 1 контур / VRF 2 контури), скидають "серію" й самі позицією не є.
function parseKkbMhiSheet(wb) {
  const rows = sheetRows(wb, 'ККБ MHI');
  if (!rows) return [];
  const items = [];
  let currentCategory = null;
  let currentSeries = null;
  for (let r = 5; r <= 25 && r < rows.length; r++) {
    const row = rows[r] || [];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim().replace(/\s+/g, ' ');
    if (!colB) {
      if (colA) { currentCategory = colA; currentSeries = null; }
      continue;
    }
    if (colA) currentSeries = colA;
    const groupKey = currentSeries || currentCategory;
    items.push({ model: colB, price: null, currency: '', onRequest: true, groupKey, groupLabel: groupKey });
  }
  return assignGroupColors(items);
}

// previousData — попередньо завантажений sheetsData (з кешу чи попередньої версії),
// потрібен лише для м'якого попередження "різко зменшилась кількість позицій" (issues,
// нижче) — на сам розбір поточного файлу ніяк не впливає.
function buildSheetsData(wb, previousData) {
  const data = {};
  seriesRowGroupMaps = {};
  const problems = [];
  // issues — те саме, що й problems, але структуровано (для самодіагностики прайсу,
  // report_price_issue — див. reportPriceDiagnostics) і з додатковими "м'якими"
  // попередженнями (kind: 'warning'), яких немає в problems/#error-block.
  const issues = [];

  CATALOG_TILES.forEach(tile => {
    ['mhi', 'gal'].forEach(brand => {
      const cfg = tile[brand];
      if (!cfg) return;
      if (!wb.SheetNames.includes(cfg.sheet)) {
        const msg = 'Вкладку "' + cfg.sheet + '" не знайдено у файлі прайсу';
        problems.push(tile.label + ' / ' + brand.toUpperCase() + ' (вкладку "' + cfg.sheet + '" не знайдено у файлі)');
        issues.push({ tile: tile.label, brand: brand, kind: 'error', message: msg });
        return;
      }
      const sheet = wb.Sheets[cfg.sheet];
      let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (cfg.splitMarker) rows = sliceBySplitMarker(rows, cfg.splitMarker, cfg.splitSide);
      const result = parseSheet(rows, cfg.highlight, { seriesLabelMode: cfg.seriesLabelMode, labelSequence: cfg.labelSequence, multisplitSections: cfg.multisplitSections, blockGrouping: cfg.blockGrouping, pairOutdoor: cfg.pairOutdoor, pairSplitOutdoor: cfg.pairSplitOutdoor });
      seriesRowGroupMaps[cfg.key] = result.rowGroupMap;
      if (result.items.length > 0) {
        if (cfg.baseAdjustPct) {
          const factor = 1 - cfg.baseAdjustPct / 100;
          result.items.forEach(it => { it.price = it.price * factor; });
        }
        data[cfg.key] = result.items;
        // М'яке попередження, а не помилка: різке падіння кількості позицій порівняно з
        // раніше завантаженою версією найчастіше означає, що частина рядків прайсу не
        // розпізналась (злиті клітинки, зміна структури аркуша), а не те, що асортимент
        // справді так сильно скоротився. Поріг 4 позицій — щоб не сіпатись на дрібних
        // тайлах, де й 2-3 позиції — нормальна кількість.
        const prevItems = previousData && previousData[cfg.key];
        if (prevItems && prevItems.length >= 4 && result.items.length < prevItems.length * 0.5) {
          issues.push({
            tile: tile.label, brand: brand, kind: 'warning',
            message: 'Різко зменшилась кількість позицій: було ' + prevItems.length + ', стало ' + result.items.length + ' — можливо, частина рядків не розпізналась'
          });
        }
      } else {
        const msg = result.error || 'Не знайдено жодної позиції з ціною';
        problems.push(tile.label + ' / ' + brand.toUpperCase() + (result.error ? ' (' + result.error + ')' : ''));
        issues.push({ tile: tile.label, brand: brand, kind: 'error', message: msg });
      }
    });
  });

  // Кастомні розділи "Теплові насоси" і "Мультизональні VRF" — нестандартна структура
  // аркушів (вкладені комплекти, кілька вкладок прайсу в одній вкладці застосунку), тому
  // не проходять через generic CATALOG_TILES.forEach/parseSheet вище, а розбираються
  // окремими функціями (див. CUSTOM_SHEET_DIAG) — але тепер через ту саму обгортку
  // parseCustomTileSheet(), що й звичайні вкладки: відсутня вкладка чи 0 позицій так само
  // потрапляють у problems/issues (самодіагностика price_issues).
  CUSTOM_SHEET_DIAG.forEach(entry => {
    data[entry.key] = parseCustomTileSheet(wb, entry.sheet, entry.tile, entry.brand, entry.parse, problems, issues);
  });

  return { data, problems, issues };
}

/* ---------- Кеш прайсу (локально на пристрої) ---------- */
/* PARSER_VERSION — версія ЛОГІКИ розбору прайсу (не самого файлу price.xlsx).
   Якщо на телефоні користувача вже лежить закешований розібраний прайс зі старою
   версією логіки (наприклад, до того як з'явились підписи серій) — кеш ігнорується
   і прайс перечитується наново, навіть якщо сам price.xlsx на сервері не змінювався.
   Піднімай цю цифру щоразу, коли міняєш buildSheetsData/parseSheet так, що це впливає
   на те, що саме зберігається в sheetsData — інакше користувачі з уже завантаженим
   кешем не побачать змін, поки хтось не перезалить прайс на Supabase. */
const PARSER_VERSION = 14; // 14: item.splitOutdoor (пара внутр./зовн. у Спліт-системах, для залишків з 1С); 13: item.outdoorModel (semi_gal), прибрано productivityCooling/Heating

/* Версія прайсу — це насправді ДАТА, закодована цифрами: 20260911 = 11.09.2026
   (правило користувача, підтверджене 2026-09-21). Показувати дилеру голе "версія
   20260911" сенсу немає, тому розкладаємо назад у дату. Якщо колись версія буде не
   у форматі дати — чесно пишемо "версія N", нічого не ламається.
   Навмисно НЕ беремо price_meta.updated_at: його ніхто не оновлює при заміні файлу
   (перевірено — там стоїть 4 вересня при версії 20260911), тобто воно бреше. */
function priceVersionLabel(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return 'Прайс, версія ' + s;
  const d = Number(m[3]), mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 'Прайс, версія ' + s;
  return 'Прайс від ' + m[3] + '.' + m[2] + '.' + m[1];
}

function loadProcessedCache() {
  try {
    const raw = localStorage.getItem('sunice_price_cache');
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (!cached || !cached.data) return false;
    if (cached.parserVersion !== PARSER_VERSION) return false; // логіка розбору змінилась — треба перечитати
    sheetsData = cached.data;
    priceDataStripped = cached.stripped === true;
    priceVersion = cached.version || null;
    setCatalogStatus(priceVersionLabel(priceVersion) || 'Прайс завантажено');
    return true;
  } catch (e) {
    return false;
  }
}
/* Чи містить опис позиції ціни. Прапорець ставить парсер; перевірка на "у.е." —
   підстраховка для кешів, збережених до 2026-09-19, де прапорця ще немає. */
function breakdownHasMoney(it) {
  return !!it.breakdownHasPrices || /у\.е\./.test(it.breakdownText || '');
}

/* Копія розібраного прайсу без жодних цін — саме її зберігаємо на пристрій тому, хто
   доступу до цін не має. Чому не просто "нічого не зберігати": price.xlsx важить ~10 МБ,
   і без кешу гість із заблокованим качали б ці 10 МБ при КОЖНОМУ запуску заради самих
   лише назв моделей, які їм і так показують. Тож лишаємо назви й групування, прибираємо
   все, з чого можна дістати ціну. */
function stripPricesFromSheets(data) {
  const out = {};
  Object.keys(data || {}).forEach(function (key) {
    const items = data[key];
    if (!Array.isArray(items)) { out[key] = items; return; }
    out[key] = items.map(function (it) {
      const copy = Object.assign({}, it);
      delete copy.price;
      delete copy.priceText;
      delete copy.currency;
      if (breakdownHasMoney(copy)) delete copy.breakdownText;
      return copy;
    });
  });
  return out;
}

/* Зберігає розібраний прайс на пристрій. Тому, хто має доступ, — як є; решті —
   знеціненою копією (stripped: true), щоб на пристрої не лишалось цін. */
/* Збій збереження кешу більше не зникає безслідно (2026-09-21).
   Чому це важливо: у localStorage близько 5 МБ на застосунок, а розібраний прайс уже
   важить ~1,7 МБ тексту (на iPhone символи рахуються по 2 байти, тобто ~3,4 МБ з 5).
   Коли місця забракне, setItem кине QuotaExceededError — раніше його мовчки ковтав
   `catch (e) {}`, і застосунок просто почав би качати 10,6 МБ прайсу ПРИ КОЖНОМУ
   запуску, а причину ніхто б не побачив. Тепер це потрапляє в "Діагностику прайсу"
   у супер-адміна — там, де вже живуть проблеми розбору.
   Рапортуємо один раз за запуск: інакше кожне відкриття каталогу писало б новий рядок. */
let priceCacheFailureReported = false;
function persistProcessedCache(version) {
  try {
    const stripped = !hasFullAccess;
    localStorage.setItem('sunice_price_cache', JSON.stringify({
      data: stripped ? stripPricesFromSheets(sheetsData) : sheetsData,
      version: version, savedAt: Date.now(), parserVersion: PARSER_VERSION, stripped: stripped
    }));
  } catch (e) {
    if (priceCacheFailureReported) return;
    priceCacheFailureReported = true;
    try {
      sb.rpc('report_price_issue', {
        p_version: String(version == null ? '' : version),
        p_tile_label: 'Кеш прайсу на пристрої',
        p_brand: '-',
        p_kind: 'warning',
        p_message: 'Не вдалося зберегти прайс на пристрій (' + ((e && e.name) || 'помилка') +
                   '). Застосунок качатиме прайс наново при кожному запуску — найімовірніше, ' +
                   'скінчилось місце в сховищі браузера.'
      }).catch(function () {});
    } catch (e2) {}
  }
}

async function checkPriceVersion() {
  try {
    const { data, error } = await sb.from('price_meta').select('version, updated_at').eq('id', 1).single();
    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// newVersion — версія прайсу (з price_meta), яку саме зараз завантажуємо; передається
// явно викликачем (а не читається з глобальної priceVersion), бо в обох місцях виклику
// (initCatalog/handleRefreshClick) priceVersion оновлюється ПІСЛЯ цього виклику — інакше
// самодіагностика підписувала б знахідки старою версією.
async function downloadAndParsePrice(newVersion, opts) {
  /* onStage — щоб екран міг сказати людині, що саме зараз відбувається: файл прайсу
     важить близько 10 МБ, і між «качаю» та «розбираю» на слабкому телефоні відчутна
     різниця в часі. Без етапів обидва виглядали як однакове мовчазне «Завантаження...». */
  const stage = (opts && opts.onStage) || function () {};
  stage('download');
  const res = await fetch(PRICE_FILE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  priceRawBuffer = buf; // для extractSeriesImages() — той самий буфер, без повторного качання
  seriesImageCache = {}; // новий файл прайсу — стара прив'язка картинок до серій більше не валідна
  stage('parse');
  /* Віддаємо браузеру кадр, щоб він УСПІВ намалювати «Готуємо каталог…».
     XLSX.read синхронний і на 10 МБ блокує потік на кілька секунд — без цієї паузи
     напис ставився б у DOM і ніколи не з'являвся на екрані: перемальовка починається
     тільки після того, як розбір закінчився. Перевірено живцем 2026-10-08: етап не
     показувався жодного разу, поки не додали цей рядок. */
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const previousData = sheetsData;
  const { data, problems, issues } = buildSheetsData(wb, previousData);
  sheetsData = data;
  priceDataStripped = false; // щойно розібраний прайс — з цінами
  const errBlock = document.getElementById('error-block');
  errBlock.innerHTML = problems.length
    ? '<div class="warn">Не вдалося розпізнати: ' + escapeHtml(problems.join(', ')) + '</div>'
    : '';
  reportPriceDiagnostics(issues, newVersion);
  // Універсальна самодіагностика (звірка з Excel, таблиця посилань): у фоні, поки workbook ще
  // в пам'яті. Ручний прогін (кнопка «Перевірити зараз») сам запускає повний набір — тоді skipDiag.
  if (!(opts && opts.skipDiag)) {
    runDiagnostics({ manual: false, wb: wb, data: data, version: newVersion }).catch(function () {});
  }
  return { wb: wb, data: data };
}

/* Самодіагностика прайсу: тихо (без жодного UI, ніколи не блокує показ каталогу)
   повідомляє в Supabase (RPC report_price_issue/resolve_price_issue_if_ok — див.
   price-diagnostics-setup.sql) про проблеми розбору поточного price.xlsx. Працює з
   БУДЬ-ЯКОГО пристрою, що завантажив і розібрав прайс — не лише з пристрою того, хто
   його заливав — тому проблему помітять, навіть якщо сам адмін не відкриє каталог одразу
   після завантаження нового файлу. Супер-адмін бачить підсумок у Кабінеті
   (renderAdminPanel → price-diag-card). Якщо SQL ще не виконано в Supabase (функцій
   report_price_issue/resolve_price_issue_if_ok не існує) — виклик просто мовчки
   провалиться, на звичайну роботу каталогу це ніяк не впливає. */
async function reportPriceDiagnostics(issues, newVersion) {
  try {
    const version = String(newVersion != null ? newVersion : '');
    const seen = new Set();
    for (const it of issues) {
      seen.add(it.tile + '|' + it.brand);
      await sb.rpc('report_price_issue', {
        p_version: version, p_tile_label: it.tile, p_brand: it.brand,
        p_kind: it.kind, p_message: it.message
      });
    }
    // "Гасимо" раніше зафіксовані проблеми для тайлів/брендів, які цього разу розпізнались
    // нормально (їх немає серед issues) — щоб список у Кабінеті не засмічувався записами
    // про вже виправлене, і супер-адміну не доводилось вручну натискати "Вирішено".
    CATALOG_TILES.forEach(tile => {
      ['mhi', 'gal'].forEach(brand => {
        const cfg = tile[brand];
        if (!cfg) return;
        const key = tile.label + '|' + brand;
        if (!seen.has(key) && sheetsData[cfg.key] && sheetsData[cfg.key].length > 0) {
          sb.rpc('resolve_price_issue_if_ok', { p_tile_label: tile.label, p_brand: brand }).catch(function () {});
        }
      });
    });
    CUSTOM_SHEET_DIAG.forEach(entry => {
      const key = entry.tile + '|' + entry.brand;
      if (!seen.has(key) && sheetsData[entry.key] && sheetsData[entry.key].length > 0) {
        sb.rpc('resolve_price_issue_if_ok', { p_tile_label: entry.tile, p_brand: entry.brand }).catch(function () {});
      }
    });
  } catch (e) {
    // Тиха відмова — самодіагностика ніколи не повинна заважати звичайному перегляду каталогу.
  }
}

