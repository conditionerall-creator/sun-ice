/* Sun-ice — Налаштування, прапорці, клієнт Supabase, іконки
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ==================== НАЛАШТУВАННЯ ==================== */

/* APP_BUILD переїхав сюди з 03-diagnostics.js 2026-10-09: він потрібен уже в цьому
   файлі (адреса stock.js будується з нього), а 03 вантажиться пізніше — вийшов би
   ReferenceError. Місце тут і логічніше: це налаштування, а не діагностика. */
const APP_BUILD = '2026-10-09.24'; // міняти разом із кожною заливкою; МУСИТЬ збігатися з ?v= у всіх <script src> в index.html і зі списком APP_SHELL у sw.js (стереже перевірка «Модулі застосунку»)
const SUPABASE_URL = 'https://pwyeifgjfyymhhvzigcg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CFO8bbjiwrqfnTiuPf2SJg_r9Zt-cke';
const PRICE_FILE_URL = SUPABASE_URL + '/storage/v1/object/public/price/price.xlsx';

/* Підписи серій для ПОБУТОВІ / MHI (плитка "Спліт-системи"), задані користувачем вручну —
   спроба автоматично витягати "жирні слова" з Excel через SheetJS у реальному браузері
   не спрацювала (бібліотека не віддає richtext-форматування клітинки на цьому проєкті),
   тому список нижче — єдине надійне джерело цих підписів.
   fromModel — код МОДЕЛІ (колонка B), з якого починається серія/під-група; підпис діє
   для всіх наступних рядків, поки не зустрінеться наступний fromModel у списку.
   Якщо в майбутньому прайсі з'являться нові серії — сюди треба додати новий рядок,
   інакше нова серія просто покаже свій короткий буквений код (як було раніше), нічого
   не зламається. */
const SPLIT_MHI_LABELS = [
  { fromModel: 'SRK20ZSPR-S', label: 'Популярний інвертор R410' },
  { fromModel: 'SRK25ZSP-W1', label: 'Популярний інвертор R32' },
  { fromModel: 'SRK15ZTL-W', label: 'Серія ZTL-W R32' },
  { fromModel: 'SRK20ZS-W', label: 'БІЗНЕС-КЛАС ДИЗАЙН СЕРІЯ R32' },
  { fromModel: 'SRK20ZT-WF', label: 'Premium Series ZT-W R32' },
  { fromModel: 'SRK20ZT-WFT', label: 'Внутрішні кольорові' },
  { fromModel: 'SRC20ZT-WB', label: 'Зовнішні чорні' },
  { fromModel: 'SRK63ZR-W', label: 'Потужний інвертор R32' },
  { fromModel: 'SRK20ZSX-W', label: 'ТЕПЛОВИЙ НАСОС / БІЗНЕС-КЛАС / ДИЗАЙН СЕРІЯ R32' },
  { fromModel: 'SRF25ZS-W', label: 'Моделі 2-х потокові підлогового виконання' },
  { fromModel: 'SRR25ZS-W', label: 'Моделі канальні R32 DC PAM Inverter' },
  { fromModel: 'UT-BAT1EF', label: 'Комплект для забору повітря знизу (опція)' },
  { fromModel: 'FDTC25VH1', label: 'Моделі 4-х потокові компактні касети 600х600' },
  // Excel-рядок над RC-E5 ("Пульт для касетного блоку замовляється додатково як опція!") —
  // це попередження саме про касетні блоки вище по списку, а НЕ назва цього розділу: сам
  // розділ охоплює різні пульти, шлюз (SC-BIKN2-E) і Wi-Fi адаптери (AM-MHI-01, WF-RAC), а
  // не тільки касетні пульти. Підпис розділу — узагальнений "Пульти", а те попередження —
  // окремим статичним рядком під заголовком (note, завжди видимий, без кліку), а НЕ у
  // спливаючому вікні "детальніше". `note` тут навмисно вимикає саме спливаюче вікно для
  // цієї групи цілком (без опису, без фото WF-RAC/іншого аксесуара, що плутав користувача
  // — фото стосувалось лише одного з восьми товарів у групі, а не "пультів" загалом) —
  // див. parseSheet, гілка labelMap: коли в entry є note, item.groupFullText примусово null.
  { fromModel: 'RC-E5', label: 'Пульти', note: 'Пульт для касетного блоку замовляється додатково як опція!' }
];

/* Плитки головного екрану каталогу, у потрібному порядку.
   Плитка з "mhi"/"gal" — активна (є перемикач брендів MHI/GAL).
   Плитка без них — поки не наповнена, показується сірою "Скоро". */
const CATALOG_TILES = [
  {
    id: 'split', label: 'Спліт-системи', img: 'tile-images/tile-split.webp',
    flipImg: 'tile-images/tile-split-galactic.webp',
    mhi: { key: 'split_mhi', sheet: 'ПОБУТОВІ', highlight: 'series', labelSequence: SPLIT_MHI_LABELS, pairSplitOutdoor: true },
    gal: { key: 'split_gal', sheet: 'GALACTIC', highlight: 'series', splitMarker: 'мульти-спліт систем', splitSide: 'before', seriesLabelMode: 'first-sentence', pairSplitOutdoor: true }
  },
  {
    id: 'multisplit', label: 'Мульти спліт-системи', img: 'tile-images/tile-multisplit.webp',
    flipImg: 'tile-images/tile-multisplit-galactic.webp',
    mhi: { key: 'multisplit_mhi', sheet: 'МУЛЬТИСИСТЕМИ', highlight: 'series', multisplitSections: true, blockGrouping: true },
    gal: { key: 'multisplit_gal', sheet: 'GALACTIC', highlight: 'series', splitMarker: 'мульти-спліт систем', splitSide: 'after', multisplitSections: true }
  },
  {
    id: 'semi', label: 'Напівпромислові спліт-системи', img: 'tile-images/tile-semi.webp',
    flipImg: 'tile-images/tile-semi-galactic.webp',
    mhi: { key: 'semi_mhi', sheet: 'НАПІВПРОМ', highlight: 'category', baseAdjustPct: 20 },
    gal: { key: 'semi_gal', sheet: 'Galactic LCAC', highlight: 'category', pairOutdoor: true }
  },
  { id: 'vrf', label: 'Мультизональні VRF', img: 'tile-images/tilevrf.webp', flipImg: 'tile-images/tilevrf-galactic.webp', custom: 'vrf' },
  { id: 'ccb', label: 'Компресорно-конденсаторні блоки (ККБ)', img: 'tile-images/tile-kkb.webp', flipImg: 'tile-images/tile-kkb-mhi.webp', custom: 'kkb' },
  { id: 'heatpumps', label: 'Теплові насоси', img: 'tile-images/tileheatpumps.webp', flipImg: 'tile-images/tileheatpumps-qton.webp', custom: 'heatpumps' },
  // Чиллери — єдина плитка на статичних даних (CLINT_SERIES), не з прайсу: асортимент
  // Clint дилер тут лише оглядає, ціни всі "за запитом". Фото плитки — ті самі файли,
  // що й у сітці категорій усередині, щоб не тримати в репо дублі тих самих знімків.
  { id: 'chillers', label: 'Чиллери', img: 'tile-images/tile-clint-commercial.webp', flipImg: 'tile-images/tile-clint-watercooled.webp', custom: 'chillers' },
  { id: 'ventilation', label: 'Вентиляційне обладнання', img: 'tile-images/tile-ventilation.webp', flipImg: 'tile-images/tile-ventilation-save.webp', custom: 'ventilation' },
  { id: 'aircurtains', label: 'Повітряні завіси', img: 'tile-images/tile-aircurtains.webp', flipImg: 'tile-images/tile-aircurtains-frico.webp', custom: 'aircurtains' },
  { id: 'consumables', label: 'Витратні матеріали', img: 'tile-images/tile-consumables.webp', flipImg: 'tile-images/tile-consumables-s30.webp', custom: 'consumables' },
  { id: 'convectors', label: 'Конвектори та обігрівачі' }
];

/* ЖАРТ-НАПИСИ (тимчасово) — щоб прибрати жарти, просто постав false */
const JOKE_MODE = true;

/* ІКОНКИ. true — штрихові гліфи Lucide зі вшитого спрайта (вимога дизайн-системи),
   false — миттєвий відкат на емодзі, які були раніше, без заливання іншого файлу.
   Відкат працює і для статичної розмітки: у ній кожна іконка несе data-fb з емодзі,
   і swapIconsToEmoji() нижче підміняє їх при старті. */
const ICONS_LUCIDE = true;

/* Повертає розмітку іконки: або <use> зі спрайта, або емодзі-запасний варіант.
   fb — емодзі, яке стояло тут до редизайну (воно ж потрапляє в data-fb). */
/* Маркування для розмітки. Напівпром MHI — це «FDE100VH+FDC100VNA-W», суцільний токен
   без пробілів: браузер не має де його перенести, і він з'їдав увесь рядок. <wbr> дає
   точку переносу рівно після «+», тож рветься між блоками, а не посеред артикула. */
/* Маркування для розмітки.
   Напівпром MHI — це пара блоків «SRK100ZR-W + FDC100VNX-W» (106 позицій із 161).
   Колонка назви вузька (~230px), і одним рядком така пара не вміщалась.
   Пробували покластись на автоперенос — браузер рвав ПОСЕРЕД артикула
   («FDC100VNX-» / «W»), що читається як помилка. Тому розрив примусовий і завжди
   в одному місці.
   З 2026-10-09 плюс лишається в КІНЦІ першого рядка, а другий починається одразу з
   маркування (прохання власника): «FDT71VNPVD +» / «FDC71VNP». До того було
   «FDT71VNPVD» / «+ FDC71VNP» — плюс на початку рядка читався як окремий пункт
   списку й зсував друге маркування вправо. */
function modelHtml(model) {
  return escapeHtml(model)
    .replace(/ \+ /g, ' +<br>')
    // Злите «FDE100VH+FDC100VNA-W» (у цьому прайсі не трапляється, але буває в інших) —
    // даємо точку переносу після плюса, щоб і воно не рвалось посеред артикула.
    .replace(/([^\s>])\+(\S)/g, '$1+<wbr>$2');
}



function ic(name, fb, cls) {
  if (!ICONS_LUCIDE) return fb ? '<span class="ic-fb">' + fb + '</span>' : '';
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#ic-' + name + '"></use></svg>';
}
function swapIconsToEmoji() {
  document.querySelectorAll('svg.ic[data-fb]').forEach(el => {
    const span = document.createElement('span');
    span.className = 'ic-fb';
    span.textContent = el.getAttribute('data-fb');
    el.replaceWith(span);
  });
}

/* Push-сповіщення адміністраторам про нову заявку + лічильник на іконці застосунку.
   Публічний VAPID-ключ — безпечно тримати в клієнтському коді (це не секрет). */
const VAPID_PUBLIC_KEY = 'BIoU6N899jbSOeI02wfVBgX5M4VUq6oM-Vz_TeDiUYxIdjgbW9w2Jeza2ao54kirnajo6eSDzo6QA_-wnmBYKiM';
/* ======================================================= */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Залишки з 1С — окремий файл stock.js (план і рішення: claude/stock-1c/00-ПЛАН-І-СТАТУС.md). Файл підвантажується
   ЛИШЕ адмінам (regional_admin/super_admin): звичайні користувачі й гості його навіть не завантажують. Разом із
   запитом до сервера це подвійний замок: бейдж не з'явиться без прав, а get_stock() сам відмовить неадміну.
   Піднімай ?v= разом зі зміною stock.js. */
/* Версію НЕ пишемо руками — беремо APP_BUILD, який піднімає set-build.py.
   Своя захардкоджена версія вже підводила: правили stock.js, забували підняти
   ?v=, і браузер віддавав стару копію (2026-10-09, четвертий раз за два дні). */
const STOCK_JS_FILE = 'stock.js?v=' + APP_BUILD;
let stockModuleLoading = false;
function syncStockModule(isAdmin) {
  if (!isAdmin) { if (window.Stock) window.Stock.reset(); return; } // вихід із акаунта/втрата прав — прибрати залишки з екрана
  if (window.Stock) { window.Stock.refresh(); return; }
  if (stockModuleLoading) return;
  stockModuleLoading = true;
  const el = document.createElement('script');
  el.src = STOCK_JS_FILE;
  el.onload = () => { stockModuleLoading = false; if (window.Stock) window.Stock.refresh(); };
  el.onerror = () => { stockModuleLoading = false; }; // офлайн/збій — просто без залишків
  document.head.appendChild(el);
}

/* Спільна перевірка prefers-reduced-motion для всіх анімацій застосунку (словник
   анімацій — CSS-класи всередині @media (prefers-reduced-motion: no-preference) в
   <style>, і той самий прапорець тут в JS, щоб не запускати навіть JS-частину
   ефекту — таймери, обчислення transform-origin тощо — коли анімації вимкнені
   системно). */
const prefersReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let currentTab = 'catalog';
let sheetsData = {};
/* true — коли sheetsData/кеш на пристрої зберігають прайс БЕЗ цін (копія для гостя чи
   заблокованого, див. stripPricesFromSheets). Якщо доступ раптом з'явиться, з такими
   даними ціни показати неможливо — треба перекачати прайс (див. ensureAccessFresh). */
let priceDataStripped = false;
/* rowGroupMap (з parseSheet) для кожного tile-key, що використовує highlightMode 'series'/
   'category' — потрібен лише extractSeriesImages() для прив'язки вбудованих у Excel
   картинок серій до правильної групи (рядок картинки → яка серія "діяла" на цьому рядку
   аркуша). Перебудовується заново при кожному розборі прайсу (buildSheetsData). */
let seriesRowGroupMaps = {};
/* Сирий ArrayBuffer щойно завантаженого price.xlsx — тримаємо в пам'яті (не тільки розібраний
   sheetsData), щоб extractSeriesImages() міг дістати вбудовані картинки серій без повторного
   якання файлу. Може бути null, якщо каталог відкрився з локального кешу (без мережевого
   завантаження цієї сесії) — ensurePriceRawBuffer() тоді довантажує сам файл лише в момент,
   коли користувач реально відкриває картинку (лінива, не при вході в застосунок). */
let priceRawBuffer = null;
/* Map<sheetName, Promise<Map<groupLabel, blobUrl>>> — розбір drawings/media одного аркуша
   (unzip + XML) робиться один раз за сесію й кешується тут, а не при кожному тапі. */
let seriesImageCache = {};
let activeTile = null; // null = меню категорій каталогу
let activeBrand = 'mhi'; // 'mhi' | 'gal' — активний бренд у плитці з перемикачем
/* Плитка "Теплові насоси": null = меню з 3 плиток (MHI/HeatGuard/WineGuard) — див.
   renderHeatpumpsList(). Перемикання між плитками — через history.pushState (як і в "Інфо"),
   щоб апаратна/шапкова кнопка "назад" повертала саме до цього меню. */
let heatpumpsBrand = null;
let ventilationBrand = null; // null = меню (поки лише Systemair)
/* Плитка "Чиллери": null = сітка з 6 категорій Clint, інакше id категорії —
   див. renderChillersList(). Перемикання через history.pushState, як у теплових насосах. */
let chillersCategory = null;
let systemairSearchQuery = '';
const SYSTEMAIR_BATCH = 200;
let systemairRenderCount = SYSTEMAIR_BATCH;
/* FRICO (аркуш "Повітряні завіси") — ~1000 позицій, той самий порядок величини, що й
   SYSTEMAIR (обидва каталоги без групування, весь асортимент виробника). Без порційного
   рендеру (як тут) синхронна побудова ~1000 DOM-рядків одразу при відкритті плитки й була
   причиною помітної затримки, якої немає в інших розділах (там на порядок менше позицій).
   REMAK (другий бренд цієї ж плитки) — рядків набагато менше за один батч, тому кнопка
   "Показати ще" для нього просто ніколи не з'явиться, окремої гілки не треба. */
const AIRCURTAINS_BATCH = 200;
let aircurtainsRenderCount = AIRCURTAINS_BATCH;
/* Плитка "Мультизональні VRF": для MHI — 3 перемикачі за вкладками прайсу (як activeBrand,
   без history.pushState), для GAL — 2 перемикачі (зовнішні/внутрішні). */
let vrfMhiSource = 'outdoor'; // 'outdoor' | 'indoor_r410a' | 'indoor_kxze1w'
let vrfGalSide = 'outdoor';   // 'outdoor' | 'indoor'
let priceVersion = null;

/* На якому етапі зараз прайс. До 2026-10-08 застосунок не розрізняв «качаю»,
   «розбираю» і «не зміг» — усюди був однаковий напис «Завантаження...», і при поганому
   зв'язку людина дивилась на нього без жодної підказки, скільки ще чекати і що робити.
   Відсотків свідомо НЕ показуємо: справжнього прогресу розбору ми не знаємо, а вигадана
   цифра гірша за її відсутність — вона обіцяє те, чого ніхто не міряв.
   'idle' | 'download' (качаємо файл) | 'parse' (розбираємо) | 'error' | 'ready' */
let priceLoadState = 'idle';
let priceLoadError = null; // текст останньої помилки, щоб показати її біля блоку, а не в нікуди
let catalogInitDone = false;
let usdRate = null;      // курс $ → грн (з app_settings), для перерахунку в калькуляторі
let eurRate = null;      // курс € → грн. ДОВІДКОВИЙ: у розрахунках не бере участі (див. нижче)
let rateEffectiveDate = null;  // дата, ВІД ЯКОЇ діє курс — вводить адміністратор руками
let rateUpdatedByName = null;  // хто востаннє міняв курс (ставить тригер у базі)
let rateUpdatedAt = null;      // коли востаннє міняли (теж тригер)
let canEditRate = false; // чи може поточний користувач редагувати курс (regional_admin/super_admin)
let rateViewerIsAdmin = false; // адмінам показуємо додатковий рядок "хто і коли змінював"
/* "Підбірка" (кошик) — позиції, які користувач додав галочкою біля рядка прайсу, щоб
   зібрати кілька товарів в один розрахунок і поділитися одним повідомленням. Ключ кожної
   позиції унікальний у межах плитки+бренду+моделі, щоб той самий кошик коректно різнив
   однакові моделі з різних розділів каталогу. */
let cart = [];
let cartRestored = false; // чи вже піднімали збережену підбірку з пристрою за цей запуск
let cartToastTimer = null;
// Калькулятор у рядку прайсу: тримаємо, який саме .calc-panel зараз розкритий (лише один
// одночасно), щоб дотик поза ним чи гортання списку самі його згортали.
let openCalcPanelEl = null;
let calcPanelOpenedAt = 0;
/* Повні тексти описів серій для спливаючого вікна "детальніше" — заповнюється заново
   при кожному renderCatalogList(). Тримаємо тут (а не в data-атрибуті HTML), бо в описах
   з прайсу трапляються лапки " і апостроф ' — у HTML-атрибуті вони можуть зламати розмітку. */
let seriesInfoTexts = [];

/* Навігація вкладки "Інфо": null = верхнє меню (Каталоги / Технічна інфа) */
let infoSection = null; // 'catalogs' | 'techinfo' | 'mhi-compat' | null
let infoBrand = null;   // 'mhi' | 'galactic' | null

/* "Сумісність блоків MHI" — видима лише regional_admin/super_admin (перевіряється в
   renderMhiCompatFolders(), а не тільки прихованням пункту меню, щоб пряме посилання-хеш
   теж не пускало звичайного користувача). Дані — заздалегідь вивантажені з дилерських
   xlsx-таблиць сумісності MHI в data/mhi-compat-tables.json (самі xlsx НЕ в репозиторії).
   На відміну від видаленої раніше версії цієї фічі — тут НЕМАЄ жодного розбору/зіставлення
   маркувань: просто показуємо таблицю з прайсу як є, з закріпленими шапкою і першою
   колонкою, а користувач сам знаходить потрібний рядок/стовпець і дивиться перетин. */
let mhiCompatFolder = null; // 'household' | 'semi' | null
let mhiCompatSheet = 'rac'; // 'rac' | 'racMulti' — актуально лише для folder==='household'
let mhiCompatData = null;   // null (ще не завантажено) | 'loading' | 'error' | {rac,racMulti,fd}

