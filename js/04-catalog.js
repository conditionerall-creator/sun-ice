/* Sun-ice — Курси валют, рендер каталогу, калькулятор, підбірка, тап по назві
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Курси валют у шапці каталогу (редагують regional_admin/super_admin) ----------
   ДОЛАР бере участь у калькуляторі (перемикач $/₴ у рядку прайсу).
   ЄВРО — суто довідковий: позиції в євро в прайсі є (Systemair, FRICO, REMAK, витратні),
   але перерахунок для них користувач не замовляв. Якщо колись захоче — вмикати тут же,
   у buildCalcPanelHtml, за тим самим зразком, що й долар.
   ДАТА «діє від» — вводить адміністратор руками. Бачать тільки адміністратори (до
   2026-09-30 бачили всі — користувач попросив звузити, звичайний користувач має
   бачити лише самі курси, без службової інформації про те, коли й ким вони виставлені).
   ХТО І КОЛИ змінював — ставить тригер trg_stamp_rate_author у базі (підмінити з
   браузера неможливо), бачать лише адміністратори. */
async function loadExchangeRate() {
  try {
    const { data } = await sb.from('app_settings')
      .select('usd_rate, eur_rate, rate_effective_date, rate_updated_by_name, updated_at')
      .eq('id', 1).single();
    usdRate = data && data.usd_rate != null ? Number(data.usd_rate) : null;
    eurRate = data && data.eur_rate != null ? Number(data.eur_rate) : null;
    rateEffectiveDate = data ? (data.rate_effective_date || null) : null;
    rateUpdatedByName = data ? (data.rate_updated_by_name || null) : null;
    rateUpdatedAt = data ? (data.updated_at || null) : null;
  } catch (e) {
    usdRate = null; eurRate = null;
    rateEffectiveDate = null; rateUpdatedByName = null; rateUpdatedAt = null;
  }
  try {
    const role = await getCurrentProfileRole();
    canEditRate = role === 'regional_admin' || role === 'super_admin';
    rateViewerIsAdmin = canEditRate;
  } catch (e) {
    canEditRate = false;
    rateViewerIsAdmin = false;
  }
  syncStockModule(canEditRate);
  renderRateRow();
}

/* "44,9" → "44,90 ₴". Два знаки після коми навмисно: курс 44,9 і 44,90 — те саме, але
   в рядку поруч із євро однакова кількість знаків читається рівніше. */
function formatRate(v) {
  return Number(v).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴';
}
function formatDateUa(iso) {
  if (!iso) return '';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[3] + '.' + m[2] + '.' + m[1]) : String(iso);
}

function renderRateRow() {
  const row = document.getElementById('rate-row');
  if (!row) return;
  const show = currentTab === 'catalog' && activeTile === null;
  row.style.display = show ? 'block' : 'none';
  if (!show) return;

  const usdEl = document.getElementById('rate-value');
  const eurEl = document.getElementById('rate-value-eur');
  usdEl.textContent = usdRate ? formatRate(usdRate) : 'не встановлено';
  usdEl.classList.toggle('rate-value-empty', !usdRate);
  eurEl.textContent = eurRate ? formatRate(eurRate) : 'не встановлено';
  eurEl.classList.toggle('rate-value-empty', !eurRate);

  document.getElementById('rate-edit-btn').style.display = canEditRate ? 'flex' : 'none';

  /* Приписка під курсами. Уся ліва частина («курс від …» і «хто міняв») — лише для
     адміністраторів (звужено 2026-09-30, до того дату бачили всі — див. коментар біля
     loadExchangeRate). Звичайний користувач бачить тут тільки праву частину (статус
     прайсу) або взагалі нічого. Кольором нічого не виділяємо: домовленість 2026-09-21 —
     ніякого червоного, лише спокійна підказка тим, хто може це виправити. */
  /* ОДИН рядок під курсами, порядок зліва направо (узгоджено з користувачем):
     «курс від … · <хто міняв> ............ Прайс від …».
     Права частина стоїть окремим елементом і притиснута до краю — над нею кнопка ↻.
     Ліва частина стискається: якщо місця бракує, зріжеться саме ім'я адміністратора,
     а не дати. Слово «змінив» і рік у даті навмисно прибрані — з ними рядок не
     вміщався навіть на широкому телефоні (міряв: треба 433 px при доступних 383). */
  const meta = document.getElementById('rate-meta');
  const mainEl = document.getElementById('rate-meta-main');
  const priceEl = document.getElementById('rate-meta-price');
  const left = [];
  if (rateViewerIsAdmin && rateEffectiveDate) left.push('курс від ' + formatDateUa(rateEffectiveDate));
  if (rateViewerIsAdmin && (!usdRate || !rateEffectiveDate)) {
    if (!usdRate && !rateEffectiveDate) left.push('не вказано курс долара і дату');
    else if (!usdRate) left.push('не вказано курс долара — немає перерахунку в гривню');
    else left.push('не вказано дату, від якої діє курс');
  }
  if (rateViewerIsAdmin && rateUpdatedByName) {
    const when = rateUpdatedAt ? new Date(rateUpdatedAt).toLocaleString('uk-UA', {
      hour: '2-digit', minute: '2-digit'
    }) : '';
    left.push(rateUpdatedByName + (when ? ', ' + when : ''));
  }
  const leftText = left.join(' · ');
  mainEl.textContent = leftText;
  mainEl.title = leftText; // повний текст, якщо рядок обрізало
  // Статус прайсу ("Прайс від 11.09.2026", "Завантаження…") — окремого рядка на
  // головній більше немає, він живе тут, праворуч.
  priceEl.textContent = catalogStatusText || '';
  meta.style.display = (leftText || catalogStatusText) ? 'flex' : 'none';
}

/* Перемикання "перегляд ↔ редагування" курсів. */
function openRateEditor() {
  document.getElementById('rate-view').style.display = 'none';
  document.getElementById('rate-meta').style.display = 'none';
  const box = document.getElementById('rate-edit');
  box.style.display = 'flex';
  document.getElementById('rate-input-usd').value = usdRate != null ? usdRate : '';
  document.getElementById('rate-input-eur').value = eurRate != null ? eurRate : '';
  document.getElementById('rate-input-date').value = rateEffectiveDate ? String(rateEffectiveDate).slice(0, 10) : '';
  document.getElementById('rate-edit-msg').textContent = '';
  document.getElementById('rate-input-usd').focus();
}
function closeRateEditor() {
  document.getElementById('rate-edit').style.display = 'none';
  document.getElementById('rate-view').style.display = 'flex';
  renderRateRow();
}

async function initCatalog() {
  document.getElementById('refresh-icon').style.display = 'flex';
  loadExchangeRate();
  loadSiteLinks(); // прогрів: до моменту, коли користувач зайде в розділ, файл уже в кеші
  const hadCache = loadProcessedCache();
  if (hadCache) {
    /* Прайс узявся з кеша — отже стан «не вдалося» більше не дійсний. Без цього після
       вдалої спроби «Спробувати ще раз» екран показував плитки, а всередині лишалось
       priceLoadState === 'error' (знайдено при перевірці 2026-10-08). */
    priceLoadState = 'ready';
    priceLoadError = null;
    renderCatalogView();
    /* ДО 2026-09-21 тут стояв просто return: якщо на пристрої вже лежав прайс, версію
       в price_meta не звіряли ВЗАГАЛІ. Оновити прайс можна було лише вручну, кнопкою ↻
       у кутку — а про неї більшість дилерів не знає. Тобто людина могла місяцями
       називати клієнтам ціни зі старого прайсу і не підозрювати про це.
       Тепер кеш так само показується миттєво (швидкість не втрачаємо), а звірка
       з сервером іде слідом у фоні. */
    checkPriceUpdateInBackground();
    return;
  }
  /* Етапи замість одного мовчазного «Завантаження...». Оболонка екрана малюється
     одразу (renderCatalogView нижче), а далі заповнюється даними. */
  priceLoadState = 'download';
  priceLoadError = null;
  setCatalogStatus('Завантажуємо прайс…');
  renderCatalogView();
  try {
    const meta = await checkPriceVersion();
    await downloadAndParsePrice(meta ? meta.version : null, {
      onStage: function (s) {
        priceLoadState = s;
        setCatalogStatus(s === 'parse' ? 'Готуємо каталог…' : 'Завантажуємо прайс…');
        renderCatalogView();
      }
    });
    priceVersion = meta ? meta.version : 1;
    persistProcessedCache(priceVersion);
    priceLoadState = 'ready';
    setCatalogStatus(priceVersionLabel(priceVersion) || 'Прайс завантажено');
  } catch (e) {
    priceLoadState = 'error';
    priceLoadError = (e && e.message) ? e.message : '';
    setCatalogStatus('');
  }
  renderCatalogView();
}

/* Тиха фонова звірка версії прайсу з price_meta.
   Тиха — тобто НЕ чіпає рядок стану, поки не виявиться, що прайс справді застарів:
   інакше при кожному відкритті каталогу блимало б "Перевірка оновлень…" на рівному
   місці. Немає мережі — просто мовчимо, людина далі працює з тим, що є (у цьому й
   сенс кешу). Знайшли нову версію — докачуємо і перемальовуємо відкритий екран.
   Захист від повторів: за один запуск застосунку перевіряємо один раз, і ніколи —
   паралельно з ручним ↻ (handleRefreshClick), щоб не качати 10 МБ двічі. */
let priceUpdateCheckDone = false;
let priceDownloadInFlight = false;
async function checkPriceUpdateInBackground() {
  if (priceUpdateCheckDone || priceDownloadInFlight) return;
  priceUpdateCheckDone = true;
  try {
    const meta = await checkPriceVersion();
    if (!meta || meta.version == null) return;                 // немає зв'язку — мовчимо
    if (priceVersion !== null && meta.version === priceVersion) return; // уже актуальний
    if (priceDownloadInFlight) return;
    priceDownloadInFlight = true;
    setCatalogStatus('Зʼявився новий прайс — завантажую…');
    try {
      await downloadAndParsePrice(meta.version);
      priceVersion = meta.version;
      persistProcessedCache(priceVersion);
      setCatalogStatus(priceVersionLabel(priceVersion) + ' · щойно оновлено');
      // Людина могла за цей час зайти в категорію — перемальовуємо саме те, що відкрито.
      catalogMenuSkipEnterAnim = true;
      if (currentTab === 'catalog') renderCatalogView();
      renderCartBar();
    } finally {
      priceDownloadInFlight = false;
    }
  } catch (e) {
    // Не вийшло — лишаємо те, що вже показано. Рядок стану не чіпаємо навмисно.
  }
}

async function handleRefreshClick() {
  // Фонова звірка могла вже качати прайс — двічі 10 МБ поспіль качати не треба.
  if (priceDownloadInFlight) { setCatalogStatus('Прайс уже завантажується…'); return; }
  setCatalogStatus('Перевірка оновлень...');
  const meta = await checkPriceVersion();
  if (!meta) {
    setCatalogStatus('Не вдалося перевірити оновлення. Перевірте інтернет-з’єднання.');
    return;
  }
  if (priceVersion !== null && meta.version === priceVersion) {
    setCatalogStatus(priceVersionLabel(meta.version) + ' · це найсвіжіший');
    return;
  }
  setCatalogStatus('Завантаження нового прайсу...');
  priceDownloadInFlight = true;
  try {
    await downloadAndParsePrice(meta.version);
    priceVersion = meta.version;
    persistProcessedCache(priceVersion);
    setCatalogStatus(priceVersionLabel(priceVersion) + ' · щойно оновлено');
    catalogMenuSkipEnterAnim = true; // користувач і так стоїть на цьому екрані — не повторювати stagger
    renderCatalogView();
  } catch (e) {
    setCatalogStatus('Немає підключення. Відображається остання завантажена версія прайсу.');
  } finally {
    priceDownloadInFlight = false;
  }
}

/* ---------- Відображення каталогу ---------- */
function tileHasAnyData(tile) {
  if (tile.custom === 'heatpumps') {
    return !!((sheetsData.heatpumps_mhi && sheetsData.heatpumps_mhi.length) || (sheetsData.heatguard && sheetsData.heatguard.length) || (sheetsData.wineguard && sheetsData.wineguard.length) || (sheetsData.th_ezy_qton && sheetsData.th_ezy_qton.length));
  }
  if (tile.custom === 'vrf') {
    return !!((sheetsData.vrf_mhi_outdoor && sheetsData.vrf_mhi_outdoor.length) || (sheetsData.vrf_mhi_indoor_r410a && sheetsData.vrf_mhi_indoor_r410a.length) ||
      (sheetsData.vrf_mhi_indoor_kxze1w && sheetsData.vrf_mhi_indoor_kxze1w.length) || (sheetsData.vrf_gal_outdoor && sheetsData.vrf_gal_outdoor.length) || (sheetsData.vrf_gal_indoor && sheetsData.vrf_gal_indoor.length));
  }
  if (tile.custom === 'kkb') {
    return !!((sheetsData.kkb_mhi && sheetsData.kkb_mhi.length) || (sheetsData.kkb_gal && sheetsData.kkb_gal.length));
  }
  if (tile.custom === 'ventilation') return !!(sheetsData.systemair && sheetsData.systemair.length);
  if (tile.custom === 'aircurtains') return !!((sheetsData.frico && sheetsData.frico.length) || (sheetsData.remak_curtains && sheetsData.remak_curtains.length));
  if (tile.custom === 'consumables') return !!(sheetsData.consumables && sheetsData.consumables.length);
  // Чиллери живуть на статичних даних у коді, а не в прайсі — плитка наповнена завжди.
  if (tile.custom === 'chillers') return true;
  return (tile.mhi && sheetsData[tile.mhi.key]) || (tile.gal && sheetsData[tile.gal.key]);
}
function tileActiveCfg(tile) {
  return tile[activeBrand] || tile.mhi || tile.gal || null;
}

function renderCatalogView() {
  const backBtn = document.getElementById('back-btn');
  const title = document.getElementById('title');

  if (activeTile === null) {
    backBtn.style.display = 'none';
    title.textContent = 'Каталог Sun-Ice';
    /* На головній логотип замінює текст заголовка (див. .home-logo в CSS) */
    document.querySelector('header').classList.add('home-logo');
    document.getElementById('th-ezy-instruction-btn').style.display = 'none';
    document.getElementById('q-ton-instruction-btn').style.display = 'none';
    applyCatalogStatusUi(); // на головній статус іде в рядок під курсами
    renderCatalogMenu();
  } else {
    backBtn.style.display = 'flex';
    document.querySelector('header').classList.remove('home-logo');
    applyCatalogStatusUi(); // у категорії — у власний рядок .status-row
    const tile = CATALOG_TILES.find(t => t.id === activeTile);
    title.textContent = tile ? tile.label : activeTile;
    if (activeTile !== 'heatpumps') {
      document.getElementById('th-ezy-instruction-btn').style.display = 'none';
      document.getElementById('q-ton-instruction-btn').style.display = 'none';
    }
    renderCatalogList();
  }
  renderRateRow();
  renderCartBar();
}

/* Одноразовий прапорець: пропустити stagger-появу сітки каталогу на наступному
   renderCatalogMenu(). Потрібен тільки для "оновлення прайсу на місці" (користувач
   стоїть на екрані каталогу і тисне ↻) — там сітка перемальовується з тими самими
   картками, і повторний stagger виглядав би як глюк, а не як відкриття екрана.
   При звичайному вході на екран (перша відкриття, перемикання вкладок, повернення
   з категорії) прапорець не чіпається, тому анімація грає щоразу — так і задумано. */
let catalogMenuSkipEnterAnim = false;

/* Спільний "grow+fade" перехід плитка → деталі (див. словник анімацій у <style>).
   originEl — елемент плитки, з якої "виростає" наступний екран; викликати ОДРАЗУ
   ПІСЛЯ того, як main.innerHTML вже замінено на вміст нового екрана. Переюзається на
   всіх переходах "плитка → екран" у застосунку, а не переізобретається під кожен. */
function playGrowFadeEnter(originEl) {
  if (prefersReducedMotionQuery.matches) return;
  const main = document.getElementById('main');
  if (!originEl || !main) return;
  const mainRect = main.getBoundingClientRect();
  const originRect = originEl.getBoundingClientRect();
  if (!mainRect.width || !mainRect.height) return;
  const originX = ((originRect.left + originRect.width / 2) - mainRect.left) / mainRect.width * 100;
  const originY = ((originRect.top + originRect.height / 2) - mainRect.top) / mainRect.height * 100;
  main.style.transformOrigin = originX + '% ' + originY + '%';
  main.classList.remove('grow-fade-enter');
  void main.offsetWidth;
  main.classList.add('grow-fade-enter');
  main.addEventListener('animationend', function handler() {
    main.classList.remove('grow-fade-enter');
    main.style.transformOrigin = '';
    main.removeEventListener('animationend', handler);
  });
}

/* Дзеркало playGrowFadeEnter — для кнопки "назад" зі списку моделей. Стискає й
   ховає поточний вміст #main (звідки б не було натиснуто — якір беремо як #back-btn,
   а не точну позицію плитки в сітці каталогу, бо сітки в момент виклику ще нема в
   DOM, її геометрію наперед не порахувати). callback викликається через setTimeout,
   а не animationend — той самий підхід, що і в cross-fade нижньої навігації, щоб не
   покладатись на подію, чия надійність під час фонового/схованого стану сторінки не
   гарантована. */
function playGrowFadeLeave(originEl, callback) {
  if (prefersReducedMotionQuery.matches) { callback(); return; }
  const main = document.getElementById('main');
  if (!originEl || !main) { callback(); return; }
  const mainRect = main.getBoundingClientRect();
  const originRect = originEl.getBoundingClientRect();
  if (!mainRect.width || !mainRect.height) { callback(); return; }
  const originX = ((originRect.left + originRect.width / 2) - mainRect.left) / mainRect.width * 100;
  const originY = ((originRect.top + originRect.height / 2) - mainRect.top) / mainRect.height * 100;
  main.style.transformOrigin = originX + '% ' + originY + '%';
  main.classList.add('grow-fade-leave');
  setTimeout(() => {
    main.classList.remove('grow-fade-leave');
    main.style.transformOrigin = '';
    callback();
  }, 220);
}

/* Прапорці для екрана категорії (список моделей): те саме "не повторювати stagger",
   що й для сітки каталогу (catalogMenuSkipEnterAnim), тільки для рядків прайсу —
   вмикається перед перемиканням бренду MHI/GAL(/VRF-джерела), щоб часте перемикання
   не відчувалось повільним. brandSliderPrevBrand — з якого стану "переїжджає" бігунок
   перемикача (null = щойно відкрили екран, бігунок просто з'являється на місці). */
let catalogRowsSkipStagger = false;
let brandSliderPrevBrand = null;

/* Плавно "переїжджає" заливку перемикача MHI/GAL (тільки .brand-toggle-sliding, не
   3-way VRF) до активного боку. Викликати одразу після заміни main.innerHTML. */
/* Висота шапки (position: sticky, top:0) змінюється (safe-area, банери) — рахуємо її і
   виставляємо як CSS-змінну, щоб рядок пошуку (.sticky-search, теж position: sticky) міг
   прилипати РІВНО під шапкою, а не наїжджати на неї. Викликати після кожного рендеру
   екрана, де є .sticky-search, і на resize (банер міг з'явитись/зникнути). */
function syncStickyHeaderOffset() {
  const header = document.querySelector('header');
  if (header) document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  // Другий липкий шар: перемикач брендів. Коли він на екрані, .sticky-search має
  // прилипати під ним, а не на тій самій висоті. Немає перемикача — 0px.
  const toggle = document.querySelector('#main .brand-toggle-sliding');
  document.documentElement.style.setProperty(
    '--brand-toggle-h', toggle ? toggle.offsetHeight + 'px' : '0px'
  );
}
// Висота шапки може змінюватись і БЕЗ resize вікна (курс $/статус-рядок вантажиться
// асинхронно вже ПІСЛЯ першого рендеру екрана) — ResizeObserver тримає --header-h
// коректним завжди, без потреби викликати syncStickyHeaderOffset() вручну після кожної
// такої зміни.

function positionBrandSlider(container, brand, prevBrand) {
  const slider = container.querySelector('.brand-toggle-slider');
  if (!slider) return;
  const toX = brand === 'gal' ? '100%' : '0%';
  if (prevBrand && prevBrand !== brand && !prefersReducedMotionQuery.matches) {
    const fromX = prevBrand === 'gal' ? '100%' : '0%';
    slider.style.transition = 'none';
    slider.style.transform = 'translateX(' + fromX + ')';
    void slider.offsetWidth;
    slider.style.transition = '';
    slider.style.transform = 'translateX(' + toX + ')';
  } else {
    slider.style.transform = 'translateX(' + toX + ')';
  }
}

/* Дрож + підказка на нескліковній картці "Скоро" (див. словник анімацій у <style>).
   При prefers-reduced-motion підказку все одно показуємо (це інформація, а не
   прикраса), але миттєво замість fade, і без дрожу (той суто декоративний). */
function triggerSoonFeedback(tileEl) {
  const tip = tileEl.querySelector('.menu-tile-soon-tip');
  if (!tip) return;
  if (prefersReducedMotionQuery.matches) {
    clearTimeout(tip._soonHideTimer);
    tip.classList.add('soon-tip-show-instant');
    tip._soonHideTimer = setTimeout(() => tip.classList.remove('soon-tip-show-instant'), 1800);
    return;
  }
  tileEl.classList.remove('soon-shake');
  tip.classList.remove('soon-tip-show');
  void tileEl.offsetWidth;
  tileEl.classList.add('soon-shake');
  tip.classList.add('soon-tip-show');
}

/* "Живі" плитки з двома гранями (напр. Спліт-системи MHI/Galactic) — по черзі, одна за
   одною (не хором — незалежні таймери на кожній плитці раніше іноді збігались у часі й
   усе миготіло одразу). Одна спільна черга (flipOrder) і один самопланований setTimeout
   (не setInterval — легко зупинити stopAllFlips, не продовжує рахувати, поки вкладка
   неактивна). Порядок перемішаний (не зліва-направо як у сітці) — щоб виглядало
   хаотично. Одразу після відкриття каталогу — перша плитка перегортається миттєво,
   кожна наступна через 2 сек після попередньої, щоб одразу було видно, що плитки
   "живі". А вже після першого повного проходу — значно рідше (4-6 сек між ПЕРЕГОРТАННЯМ
   ОДНІЄЇ плитки, завжди лише однієї за раз, випадково в цьому діапазоні). Зупиняється по
   кліку на будь-яку плитку каталогу, перш ніж запуститься перехід у категорію
   (growFadeEnter), щоб transform плитки не "змагався" з transform переходу. */
let flipTimer = null;
let flipOrder = [];
function stopAllFlips() {
  if (flipTimer) { clearTimeout(flipTimer); flipTimer = null; }
  flipOrder = [];
}
function startFlipRotation(flipEls) {
  stopAllFlips();
  // При системно вимкнених анімаціях плитки просто стоять на передній грані — крутити
  // їх без плавного переходу означало б різко підміняти картинку, це гірше за спокій.
  if (prefersReducedMotionQuery.matches) return;
  flipOrder = Array.from(flipEls);
  if (!flipOrder.length) return;
  // Порядок навмисно перетасований (не зліва-направо/зверху-вниз, як у сітці) — щоб
  // перегортання виглядало хаотично, а не "по черзі як по списку". Нова випадкова
  // черга щоразу при вході в каталог (Fisher-Yates).
  for (let k = flipOrder.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [flipOrder[k], flipOrder[j]] = [flipOrder[j], flipOrder[k]];
  }
  let i = 0;
  const step = (delay) => {
    flipTimer = setTimeout(() => {
      const el = flipOrder[i % flipOrder.length];
      if (document.body.contains(el)) el.classList.toggle('flipped');
      i++;
      const firstPass = i < flipOrder.length;
      step(firstPass ? 2000 : 4000 + Math.random() * 2000);
    }, delay);
  };
  step(0);
}

/* Що показувати на місці каталогу, поки прайсу немає.
   До 2026-10-08 тут був один рядок «Прайс ще не завантажено.» — і він висів однаково
   і поки файл качався, і коли зв'язку не було зовсім. Людина не знала ні що відбувається,
   ні що робити далі.
   Тепер: поки вантажиться — оболонка з порожніми плитками й назвою етапу (екран одразу
   має форму майбутнього каталогу, а не порожнечу); якщо не вийшло — пояснення саме тут,
   біля потрібного місця, з кнопкою повтору. Навігація й решта розділів при цьому
   лишаються робочими — помилка не перекриває застосунок. */
function catalogPlaceholderHtml() {
  if (priceLoadState === 'error') {
    return `
      <div class="load-error">
        <div class="load-error-title">${ic('refresh-cw', '⚠️', 'ic-lead')}Не вдалося завантажити прайс</div>
        <p class="load-error-text">Схоже, немає зв'язку з інтернетом. Збереженої копії прайсу на цьому пристрої ще немає, тому ціни показати нема з чого.</p>
        <p class="load-error-text">Решта застосунку працює: контакти, акції та CRМонтаж відкриваються й без мережі.</p>
        <button type="button" class="load-error-btn" id="price-retry-btn">Спробувати ще раз</button>
      </div>`;
  }
  const stageText = priceLoadState === 'parse'
    ? 'Готуємо каталог…'
    : (priceLoadState === 'download' ? 'Завантажуємо прайс…' : 'Прайс ще не завантажено.');
  const hint = priceLoadState === 'download'
    ? '<p class="load-skeleton-hint">Файл прайсу важить близько 10 МБ — на повільному зв\'язку це може зайняти до хвилини.</p>'
    : '';
  const cells = new Array(CATALOG_TILES.length).fill('<div class="skeleton-tile"></div>').join('');
  return `
    <div class="load-skeleton">
      <p class="load-skeleton-stage">${escapeHtml(stageText)}</p>
      ${hint}
      <div class="menu-grid">${cells}</div>
    </div>`;
}

function renderCatalogMenu() {
  stopAllFlips();
  const main = document.getElementById('main');
  const hasData = Object.keys(sheetsData).length > 0;
  if (!hasData) {
    main.innerHTML = catalogPlaceholderHtml();
    return;
  }
  const animateEntrance = !catalogMenuSkipEnterAnim;
  catalogMenuSkipEnterAnim = false;
  const tiles = CATALOG_TILES.map((tile, i) => {
    const initials = tile.label.slice(0, 2).toUpperCase();
    const filled = tileHasAnyData(tile);
    const enterAttr = animateEntrance ? ` tile-enter" style="animation-delay:${Math.floor(i / 2) * 45}ms` : '';
    if (!filled) {
      return `
        <div class="menu-tile menu-tile-empty${enterAttr}">
          <div class="menu-tile-row">
            <div class="menu-tile-icon">${escapeHtml(initials)}</div>
            <div class="menu-tile-soon">Скоро</div>
          </div>
          <div class="menu-tile-title">${escapeHtml(tile.label)}</div>
          <div class="menu-tile-soon-tip">Дані ще уточнюються</div>
        </div>`;
    }
    if (tile.img && tile.flipImg) {
      // Обидві грані — повноцінні картки (.menu-tile.menu-tile-photo) з власним підписом,
      // тому перегортається вся плитка цілком. data-tile і data-flip-tile — на обгортці:
      // клік і 3D-поворот мають стосуватись усієї картки, а не однієї з граней.
      return `
        <div class="menu-tile-3d${enterAttr}" data-flip-tile data-tile="${escapeHtml(tile.id)}">
          <div class="menu-tile-3d-inner">
            <div class="menu-tile menu-tile-photo menu-tile-face menu-tile-face-front">
              <div class="menu-tile-photo-wrap"><img src="${escapeHtml(tile.img)}" alt="" loading="lazy"></div>
              <div class="menu-tile-title">${escapeHtml(tile.label)}</div>
            </div>
            <div class="menu-tile menu-tile-photo menu-tile-face menu-tile-face-back">
              <div class="menu-tile-photo-wrap"><img src="${escapeHtml(tile.flipImg)}" alt="" loading="lazy"></div>
              <div class="menu-tile-title">${escapeHtml(tile.label)}</div>
            </div>
          </div>
        </div>`;
    }
    if (tile.img) {
      return `
        <div class="menu-tile menu-tile-photo${enterAttr}" data-tile="${escapeHtml(tile.id)}">
          <div class="menu-tile-photo-wrap"><img src="${escapeHtml(tile.img)}" alt="" loading="lazy"></div>
          <div class="menu-tile-title">${escapeHtml(tile.label)}</div>
        </div>`;
    }
    return `
      <div class="menu-tile${enterAttr}" data-tile="${escapeHtml(tile.id)}">
        <div class="menu-tile-row">
          <div class="menu-tile-icon">${escapeHtml(initials)}</div>
        </div>
        <div class="menu-tile-title">${escapeHtml(tile.label)}</div>
      </div>`;
  }).join('');
  main.innerHTML = '<div class="menu-grid">' + tiles + '</div>';
  startFlipRotation(main.querySelectorAll('[data-flip-tile]'));
  // Не '.menu-tile[data-tile]': у плиток із парою фото data-tile висить на обгортці
  // .menu-tile-3d. Її ж rect бере playGrowFadeEnter як точку, з якої "виростає" екран
  // категорії, — і це правильна геометрія, обгортка збігається з видимою карткою.
  main.querySelectorAll('[data-tile]').forEach(el => {
    el.addEventListener('click', () => {
      stopAllFlips();
      const tileId = el.getAttribute('data-tile');
      history.pushState({ tab: 'catalog', tile: tileId }, '', '#' + encodeURIComponent(tileId));
      activeTile = tileId;
      activeBrand = 'mhi';
      heatpumpsBrand = null;
      ventilationBrand = null;
      chillersCategory = null;
      systemairSearchQuery = '';
      systemairRenderCount = SYSTEMAIR_BATCH;
      aircurtainsSearchQuery = '';
      aircurtainsRenderCount = AIRCURTAINS_BATCH;
      vrfMhiSource = 'outdoor';
      vrfGalSide = 'outdoor';
      renderCatalogView();
      playGrowFadeEnter(el);
    });
  });
  main.querySelectorAll('.menu-tile-empty').forEach(el => {
    el.addEventListener('click', () => triggerSoonFeedback(el));
  });
}

/* ---------- Калькулятор ціни в рядку прайсу / підсумку мультиспліту ---------- */
/* Три режими: відняти % (знижка), додати % (маржа), або ввести кінцеву суму напряму.
   Плюс вибір валюти показу — нативна валюта прайсу ($) або перерахунок у гривню за
   курсом з шапки каталогу (usdRate), який редагують адміни/суперадміни. */
function convertAmount(amount, fromCur, toCur, rate) {
  if (fromCur === toCur || !toCur) return amount;
  if (fromCur === '$' && toCur === 'UAH') return rate ? amount * rate : amount;
  if (fromCur === 'UAH' && toCur === '$') return rate ? amount / rate : amount;
  return amount;
}
function formatCalcAmount(amount, cur) {
  const suffix = cur === 'UAH' ? ' ₴' : (cur ? ' ' + cur : '');
  return Math.round(amount).toLocaleString('uk-UA') + suffix;
}
/* Ціна позиції В СПИСКУ. ПРАВИЛО ВЛАСНИКА (2026-10-02): якщо ціну треба показати цілим числом —
   округляємо; якщо округлення дало б різницю понад 1 долар — не округляємо. (Округлення до найближчого
   дає ≤ 0,5, тож запобіжник спрацює лише для нестандартних значень; він є, щоб правило виконувалось
   буквально.) Дані (it.price) лишаються ТОЧНИМИ — як в Excel; округляється лише показ. Калькулятор і
   кошик (formatCalcAmount) власник просив не чіпати. Самодіагностика (diagVerifyDisplay) перевіряє,
   що показане число відрізняється від Excel не більше ніж на 1. */
function roundPriceForDisplay(p) {
  const r = Math.round(p);
  return Math.abs(r - p) > 1 ? p : r;
}
function formatListPriceNumber(it) {
  const v = roundPriceForDisplay(it.price);
  return Number.isInteger(v) ? v.toLocaleString('uk-UA') : v.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
}
function formatListPrice(it) {
  return formatListPriceNumber(it) + (it.currency ? ' ' + it.currency : '');
}
// Чотири режими калькулятора: відняти %, додати %, відняти суму, додати суму. За
// замовчуванням завжди −% (найчастіший випадок — знижка) — решта ховаються у спливаючому
// меню (див. CSS .calc-mode-popup) і не займають місця, поки не потрібні.
const CALC_MODE_ICON = { sub_pct: '−%', add_pct: '+%', sub_flat: '−', add_flat: '+' };
const CALC_MODE_ORDER = ['sub_pct', 'add_pct', 'sub_flat', 'add_flat'];
function buildCalcPanelHtml(price, currency, priceStr, opts) {
  opts = opts || {};
  /* Перемикач ₴ показуємо ЛИШЕ коли курс справді заданий (2026-09-21).
     Раніше кнопка була завжди, а convertAmount() без курсу повертав доларову суму
     БЕЗ перерахунку — і калькулятор чесно підписував її знаком ₴. Тобто позиція за
     1 200 $ показувалась як "1 200 ₴". Краще не дати натиснути, ніж показати неправду. */
  const curBtnsHtml = (currency === '$' && usdRate > 0) ? `
            <div class="calc-currency">
              <button type="button" class="calc-cur-btn active" data-cur="$">$</button>
              <button type="button" class="calc-cur-btn" data-cur="UAH">₴</button>
            </div>` : '';
  const cls = 'calc-panel' + (opts.open ? ' open' : '') + (opts.extraClass ? ' ' + opts.extraClass : '');
  // showBase: показати базову ціну як окремий елемент рівняння "ціна + форма% = число"
  // (використовується в калькуляторі підбірки, де це важливо бачити явно).
  const baseHtml = opts.showBase ? `<span class="calc-base">${priceStr}</span>` : '';
  const modeOptsHtml = CALC_MODE_ORDER.map(m =>
    `<button type="button" class="calc-mode-opt${m === 'sub_pct' ? ' is-current' : ''}" data-mode="${m}">${CALC_MODE_ICON[m]}</button>`
  ).join('');
  return `
          <div class="${cls}" data-price="${price}" data-currency="${escapeHtml(currency || '')}" data-mode="sub_pct" data-cur="${escapeHtml(currency || '')}">
            ${baseHtml}
            <div class="calc-mode-wrap">
              <button type="button" class="calc-mode-current" data-mode="sub_pct">−%</button>
              <div class="calc-mode-popup">${modeOptsHtml}</div>
            </div>
            <input type="number" class="calc-input" min="0" inputmode="numeric" placeholder="">${curBtnsHtml}
            <span class="calc-eq">=</span>
            <span class="calc-result">${priceStr}</span>
          </div>`;
}
function computeCalcResult(panel) {
  if (!panel) return;
  const price = parseFloat(panel.getAttribute('data-price')) || 0;
  const nativeCur = panel.getAttribute('data-currency') || '';
  const mode = panel.getAttribute('data-mode') || 'sub_pct';
  const cur = panel.getAttribute('data-cur') || nativeCur;
  const input = panel.querySelector('.calc-input');
  let val = input ? parseFloat(input.value) : NaN;
  if (isNaN(val) || val < 0) val = 0;

  // Рахуємо в тій валюті, яку зараз показує калькулятор (cur) — для %-режимів це байдуже
  // (відсоток однаково масштабується при конвертації), а для сум +/− так природніше:
  // введене число користувач сприймає як суму саме у видимій валюті ($ або ₴).
  const priceInCur = convertAmount(price, nativeCur, cur, usdRate);
  let result;
  if (mode === 'add_pct') result = priceInCur * (1 + val / 100);
  else if (mode === 'sub_flat') result = priceInCur - val;
  else if (mode === 'add_flat') result = priceInCur + val;
  else result = priceInCur * (1 - val / 100); // sub_pct (за замовчуванням)
  if (result < 0) result = 0;

  const resultEl = panel.querySelector('.calc-result');
  if (resultEl) resultEl.textContent = formatCalcAmount(result, cur);
}

/* Закриває будь-яке відкрите спливаюче меню вибору знаку в межах panel (або всюди, якщо
   panel не передано) — використовується, коли закривається сама панель калькулятора, щоб
   меню не лишалось "відкритим за лаштунками" до наступного разу. */
function closeCalcModePopups(panel) {
  const scope = panel || document;
  scope.querySelectorAll('.calc-mode-wrap.open').forEach(w => w.classList.remove('open'));
}

/* Спільна логіка калькулятора — використовується і для рядка прайсу (всередині #main), і
   для підсумку "Підбірки" (всередині #cart-panel-overlay). Повертає true, якщо подія
   оброблена (щоб виклик міг одразу зробити return). */
function handleCalcDelegatedClick(e) {
  const modeCurBtn = e.target.closest('.calc-mode-current');
  if (modeCurBtn) {
    const wrap = modeCurBtn.closest('.calc-mode-wrap');
    const willOpen = !wrap.classList.contains('open');
    closeCalcModePopups();
    wrap.classList.toggle('open', willOpen);
    return true;
  }
  const modeOptBtn = e.target.closest('.calc-mode-opt');
  if (modeOptBtn) {
    const wrap = modeOptBtn.closest('.calc-mode-wrap');
    const panel = modeOptBtn.closest('.calc-panel');
    const newMode = modeOptBtn.getAttribute('data-mode');
    panel.setAttribute('data-mode', newMode);
    const curBtn = wrap.querySelector('.calc-mode-current');
    curBtn.textContent = CALC_MODE_ICON[newMode] || newMode;
    curBtn.setAttribute('data-mode', newMode);
    wrap.querySelectorAll('.calc-mode-opt').forEach(b => b.classList.toggle('is-current', b.getAttribute('data-mode') === newMode));
    wrap.classList.remove('open');
    computeCalcResult(panel);
    return true;
  }
  const curBtn2 = e.target.closest('.calc-cur-btn');
  if (curBtn2) {
    const panel = curBtn2.closest('.calc-panel');
    panel.querySelectorAll('.calc-cur-btn').forEach(b => b.classList.toggle('active', b === curBtn2));
    panel.setAttribute('data-cur', curBtn2.getAttribute('data-cur'));
    computeCalcResult(panel);
    return true;
  }
  return false;
}
function handleCalcDelegatedInput(e) {
  if (!e.target.classList.contains('calc-input')) return false;
  computeCalcResult(e.target.closest('.calc-panel'));
  return true;
}

/* ---------- "Підбірка" (кошик) ----------
   Галочка біля рядка прайсу (.cart-check-btn) додає товар у cart[] і одразу оновлює
   тільки саму кнопку (без перерендеру всього списку — інакше гортання прайсу збивалось би
   при кожному натисканні). Плаваюча кнопка (#cart-fab) і панель (#cart-panel-overlay) —
   статичні елементи поза #main, що показуються лише коли підбірка не порожня. */
/* Збереження підбірки на пристрій (2026-09-21).
   Навіщо: до цього підбірка жила тільки в пам'яті відкритої сторінки. Дилер набирав
   10 позицій на об'єкті, телефон вивантажував застосунок з пам'яті при дзвінку — і всі
   галочки треба було ставити заново.
   Ціни в підбірці — це ціни, тому зберігаємо ЛИШЕ тому, хто має доступ (hasFullAccess),
   і стираємо, щойно доступ зник (див. ensureAccessFresh) — тим самим правилом, що й
   кеш прайсу (stripPricesFromSheets). Збій запису ігноруємо: підбірка — зручність,
   а не дані, через які можна зламати роботу. */
const CART_STORAGE_KEY = 'sunice_cart';
function persistCart() {
  try {
    if (!hasFullAccess || !cart.length) { localStorage.removeItem(CART_STORAGE_KEY); return; }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), items: cart }));
  } catch (e) {}
}
function loadStoredCart() {
  try {
    if (!hasFullAccess) return;
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    // Беремо лише рядки очікуваної форми — щоб зіпсований чи старий запис не зронив UI.
    cart = items.filter(c => c && typeof c.key === 'string' && typeof c.qty === 'number' && c.qty > 0)
                .map(c => ({ key: c.key, model: String(c.model || ''), price: Number(c.price) || 0,
                             currency: String(c.currency || ''), tileLabel: String(c.tileLabel || ''),
                             qty: Math.max(1, Math.round(c.qty)) }));
  } catch (e) { cart = []; }
}
function cartQtyFor(key) {
  const entry = cart.find(c => c.key === key);
  return entry ? entry.qty : 0;
}
function cartTotalsByCurrency() {
  const totals = {};
  cart.forEach(c => { totals[c.currency || ''] = (totals[c.currency || ''] || 0) + c.price * c.qty; });
  return totals;
}
function addToCart(btn) {
  const key = btn.getAttribute('data-key');
  const model = btn.getAttribute('data-model');
  const price = parseFloat(btn.getAttribute('data-price')) || 0;
  const currency = btn.getAttribute('data-currency') || '';
  const tileLabel = btn.getAttribute('data-tile-label') || '';
  let entry = cart.find(c => c.key === key);
  if (!entry) {
    entry = { key, model, price, currency, tileLabel, qty: 0 };
    cart.push(entry);
  }
  entry.qty += 1;
  btn.classList.add('active');
  const badge = btn.querySelector('.cart-check-badge');
  if (badge) { badge.textContent = entry.qty; badge.style.display = 'flex'; }
  showCartToast(model, entry.qty);
  renderCartBar();
}
/* Коротке повідомлення внизу шапки. Спочатку було тільки для підбірки, з 2026-09-21
   використовується ще й для повідомлень про артикул (див. openSystemairSkuPage). */
function showHeaderToast(text, ms) {
  const toast = document.getElementById('cart-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  if (cartToastTimer) clearTimeout(cartToastTimer);
  cartToastTimer = setTimeout(() => { toast.classList.remove('show'); }, ms || 1800);
}
function showCartToast(model, qty) {
  showHeaderToast(model + ' — ' + qty + ' шт. Натисни знову — буде +1');
}
function syncCartRowBadge(key) {
  const main = document.getElementById('main');
  if (!main) return;
  const entry = cart.find(c => c.key === key);
  const qty = entry ? entry.qty : 0;
  main.querySelectorAll('.cart-check-btn').forEach(btn => {
    if (btn.getAttribute('data-key') !== key) return;
    const badge = btn.querySelector('.cart-check-badge');
    if (qty > 0) {
      btn.classList.add('active');
      if (badge) { badge.textContent = qty; badge.style.display = 'flex'; }
    } else {
      btn.classList.remove('active');
      if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    }
  });
}
function syncAllCartBadges() {
  const main = document.getElementById('main');
  if (!main) return;
  main.querySelectorAll('.cart-check-btn').forEach(btn => {
    btn.classList.remove('active');
    const badge = btn.querySelector('.cart-check-badge');
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
  });
}
function renderCartBar() {
  const fab = document.getElementById('cart-fab');
  if (!fab) return;
  /* Єдина точка збереження підбірки на пристрій: renderCartBar() викликається ПІСЛЯ
     кожної зміни (додали, ± кількість, прибрали рядок, очистили, втратили доступ до
     цін) — тому достатньо одного виклику тут, замість п'яти по різних обробниках. */
  persistCart();
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  if (totalQty === 0 || currentTab !== 'catalog') {
    fab.style.display = 'none';
    if (totalQty === 0) closeCartPanel();
    return;
  }
  fab.style.display = 'flex';
  document.getElementById('cart-fab-badge').textContent = totalQty;
  if (document.getElementById('cart-panel-overlay').classList.contains('show')) renderCartPanel();
}
function renderCartPanel() {
  const body = document.getElementById('cart-panel-body');
  if (!body) return;
  if (cart.length === 0) {
    body.innerHTML = '<div class="cart-empty-hint">Підбірка порожня — натисни ✓ біля позиції в прайсі</div>';
    return;
  }
  const itemsHtml = cart.map(c => {
    const priceStr = formatCalcAmount(c.price * c.qty, c.currency);
    return `
      <div class="cart-item-row" data-key="${escapeHtml(c.key)}">
        <span class="cart-item-name">${escapeHtml(c.model)}${c.tileLabel ? '<span class="cart-item-tile">' + escapeHtml(c.tileLabel) + '</span>' : ''}<span class="cart-item-price">${priceStr}</span></span>
        <div class="cart-qty">
          <button type="button" class="cart-qty-btn" data-op="minus" aria-label="Менше">−</button>
          <span class="cart-qty-val">${c.qty}</span>
          <button type="button" class="cart-qty-btn" data-op="plus" aria-label="Більше">+</button>
        </div>
        <button type="button" class="cart-item-remove" aria-label="Видалити">✕</button>
      </div>`;
  }).join('');

  const totals = cartTotalsByCurrency();
  const currencies = Object.keys(totals);
  // Калькулятор з перерахунком валюти має сенс, лише коли всі позиції в одній валюті —
  // на практиці так завжди (весь прайс у $), але про всяк випадок обробляємо і змішаний.
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  const totalsLineHtml = currencies.map(cur => formatCalcAmount(totals[cur], cur)).join(' + ');
  const calcHtml = singleCurrency !== null
    ? buildCalcPanelHtml(totals[singleCurrency], singleCurrency, formatCalcAmount(totals[singleCurrency], singleCurrency), { open: true, extraClass: 'cart-calc-panel', showBase: true })
    : `<div class="cart-empty-hint">Разом: ${totalsLineHtml}</div>`;

  body.innerHTML = itemsHtml + `
    <div class="cart-total-row">
      ${calcHtml}
      <button type="button" class="share-btn cart-share-btn" aria-label="Поділитися підбіркою">${ic('share-2', '')}</button>
    </div>
    <button type="button" class="cart-clear-btn" id="cart-clear-btn">Очистити підбірку</button>
  `;
}
function openCartPanel() {
  renderCartPanel();
  document.getElementById('cart-panel-overlay').classList.add('show');
}
function closeCartPanel() {
  const overlay = document.getElementById('cart-panel-overlay');
  if (overlay) overlay.classList.remove('show');
}

/* ---------- Тап по назві → картка товару на sun-ice.com.ua ----------
   Розділи: Спліт-системи, Мульти спліт-системи, Напівпромислові (MHI і GAL) — усі йдуть
   через renderCatalogList(). Адреси карток лежать у data/site-links.json:
   { base, links: { <ключ списку>: { <маркування>: <slug картки> } } }.
   Ключ списку — cfg.key плитки (split_mhi, semi_gal, ...). Маркування — siteLinkKey():
   великі літери, без пробілів; для напівпрому Galactic до нього додається зовнішній блок
   ("GBZ36MLQ-W+GCZ36MLNQ-W"), бо той самий внутрішній блок стоїть у прайсі кілька разів.
   Рядок без запису (пульт, адаптер, немає картки на сайті) — тап нічого не робить.
   Файл будується скриптом claude/site-catalog/build_site_links.py з карток сайту; лише
   так: сайт не віддає CORS-заголовків, шукати картки "наживо" з браузера неможливо.
   ?v= у адресі — service worker віддає статику кеш-спершу, без зміни адреси користувачі
   довго бачили б стару копію після оновлення файлу; міняти разом із файлом. */
const SITE_LINKS_FILE = 'data/site-links.json?v=20261002-2';

let siteLinks = null;          // null — ще не вантажили, об'єкт — готово, false — не вдалось
let siteLinksPromise = null;
function siteLinkKey(item) {
  return (String(item.model || '') + (item.outdoorModel ? '+' + item.outdoorModel : ''))
    .toUpperCase().replace(/\s+/g, '');
}
function loadSiteLinks() {
  if (!siteLinksPromise) {
    siteLinksPromise = fetch(SITE_LINKS_FILE)
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(d => { siteLinks = d; return d; })
      .catch(() => { siteLinks = false; siteLinksPromise = null; return false; }); // наступний рендер спробує ще раз
  }
  return siteLinksPromise;
}
/* Розставляє посилання на рядки, що зараз у DOM. Файл міг ще не доїхати до першого
   рендеру — тоді рядки просто стають клікабельними трохи пізніше, без перемальовування. */
function applySiteLinks() {
  const run = d => {
    if (!d || !d.links) return;
    document.querySelectorAll('#main .row-name[data-site-key]').forEach(el => {
      const list = d.links[el.getAttribute('data-site-list')];
      const slug = list && list[el.getAttribute('data-site-key')];
      if (!slug) return;
      el.setAttribute('data-site-url', d.base + slug);
      el.classList.add('has-site-link');
    });
  };
  if (siteLinks) run(siteLinks); else loadSiteLinks().then(run);
}

function renderCatalogList() {
  // "Теплові насоси" і "Мультизональні VRF" мають нестандартну структуру (вкладені комплекти,
  // кілька вкладок прайсу під одним перемикачем) — рендеряться окремими функціями нижче,
  // а не спільним потоком "один плаский список" цієї функції.
  const tileForDispatch = CATALOG_TILES.find(t => t.id === activeTile);
  if (tileForDispatch && tileForDispatch.custom === 'heatpumps') { renderHeatpumpsList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'vrf') { renderVrfList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'kkb') { renderKkbList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'ventilation') { renderVentilationList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'aircurtains') { renderAirCurtainsList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'chillers') { renderChillersList(); return; }
  if (tileForDispatch && tileForDispatch.custom === 'consumables') { renderConsumablesList(); return; }

  const main = document.getElementById('main');
  openCalcPanelEl = null; // старі вузли DOM зараз буде замінено — посилання все одно застаріє

  const tile = CATALOG_TILES.find(t => t.id === activeTile);
  if (!tile) { main.innerHTML = '<div class="empty">Нічого не знайдено</div>'; return; }

  const hasBoth = !!(tile.mhi && tile.gal);
  const cfg = tileActiveCfg(tile);
  const toggleHtml = hasBoth ? `
    <div class="brand-toggle brand-toggle-sliding">
      <div class="brand-toggle-slider"></div>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'mhi' ? 'active' : ''}" data-brand="mhi">MHI</button>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'gal' ? 'active' : ''}" data-brand="gal">GAL</button>
    </div>` : '';

  // Одноразово consume: чи це перше відкриття екрана (stagger рядків, бігунок просто
  // з'являється) чи перемикання MHI/GAL на місці (без stagger, бігунок "переїжджає" з
  // попереднього боку) — прапорці виставляє attachBrandToggleHandlers перед кліком.
  const animateRows = !catalogRowsSkipStagger;
  const prevBrandForSlider = brandSliderPrevBrand;
  catalogRowsSkipStagger = false;
  brandSliderPrevBrand = null;

  const allItems = cfg ? (sheetsData[cfg.key] || []) : [];

  if (!cfg || allItems.length === 0) {
    main.innerHTML = toggleHtml + '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
    attachBrandToggleHandlers(main);
    positionBrandSlider(main, activeBrand, prevBrandForSlider);
    return;
  }

  const filtered = allItems;

  const countHtml = '<div class="count">Всього: ' + filtered.length + '</div>';
  const showSegments = true;
  let lastKey = null;
  seriesInfoTexts = [];

  const rowsHtml = filtered.map((it, rowIndex) => {
    let header = '';
    // "Зовнішні блоки"/"Внутрішні блоки" — великий заголовок секції (Мульти спліт-системи,
    // обидва бренди), над звичайним segment-header. Рахує parseSheet() у item.sectionLabel.
    const sectionLabelHtml = it.sectionLabel
      ? `<div class="section-label">${escapeHtml(it.sectionLabel)}</div>`
      : '';
    // Заголовок сегмента показуємо за "ефективним" підписом (groupLabel, якщо є — інакше
    // короткий буквений код). Так під-підписи (напр. "Внутрішні кольорові"/"Зовнішні чорні"
    // всередині однієї серії ZT) теж створюють новий заголовок, навіть якщо колір і
    // groupKey лишаються тими самими.
    const effectiveKey = it.groupLabel || it.groupKey;
    if (showSegments && effectiveKey && effectiveKey !== lastKey) {
      lastKey = effectiveKey;
      // Клікабельним заголовок робимо, лише якщо повний опис з прайсу дає щось суттєво
      // більше за сам короткий підпис — щоб не показувати вікно, у якому просто
      // повторюється той самий короткий текст. groupFullText навмисно null для груп із
      // groupNote (SPLIT_MHI_LABELS[].note, див. parseSheet) — там статична примітка під
      // заголовком заміняє спливаюче вікно, а не доповнює його.
      const hasMoreInfo = it.groupFullText && it.groupFullText.trim().length > effectiveKey.length + 15;
      // Примітка під заголовком (SPLIT_MHI_LABELS[].note) — завжди видима, без кліку.
      const noteHtml = it.groupNote ? `<div class="segment-header-note">${escapeHtml(it.groupNote)}</div>` : '';
      if (hasMoreInfo) {
        const idx = seriesInfoTexts.length;
        const infoEntry = { title: effectiveKey, text: it.groupFullText.trim() };
        // Фото серії (кондиціонера) — тільки для Спліт-систем (MHI/GAL), за проханням
        // користувача; для Мульти спліт (той самий 'series' режим на GAL) не чіпаємо.
        if (activeTile === 'split') {
          const brandAtPush = activeBrand;
          const sheetAtPush = brandAtPush === 'mhi' ? 'ПОБУТОВІ' : 'GALACTIC';
          infoEntry.getImages = async () => {
            const rowGroupMap = await getRowGroupMapForSplitTile(brandAtPush);
            const map = await extractSeriesImages(sheetAtPush, row => rowGroupMap[row]);
            return map.get(effectiveKey) || [];
          };
        }
        seriesInfoTexts.push(infoEntry);
        header = `<div class="segment-header segment-header-info" data-info-idx="${idx}" style="${it.color ? 'border-color:' + it.color : ''}">${escapeHtml(effectiveKey)}<span class="segment-header-info-icon">ⓘ</span>${noteHtml}</div>`;
      } else {
        header = `<div class="segment-header" style="${it.color ? 'border-color:' + it.color : ''}">${escapeHtml(effectiveKey)}${noteHtml}</div>`;
      }
    } else if (showSegments && !effectiveKey) {
      lastKey = null;
    }
    const locked = !hasFullAccess;
    /* Справжня ціна не потрапляє в розмітку взагалі, якщо доступу немає. Раніше сюди
       завжди йшла цифра, і ховав її лише CSS-blur поверх. */
    const priceStr = locked
      ? ic('lock', PRICE_HIDDEN_TEXT)
      : formatListPrice(it);
    const cartKey = activeTile + '|' + activeBrand + '|' + it.model;
    const cartQty = cartQtyFor(cartKey);
    const rowCls = 'row' + (locked ? ' row-locked' : '') + (animateRows ? ' tile-enter' : '');
    const rowStyle = (it.color ? 'border-left:4px solid ' + it.color + ';border-right:4px solid ' + it.color + ';' : '') + (animateRows ? 'animation-delay:' + (rowIndex * 45) + 'ms;' : '');

    /* data-row-* — щоб панель товару (П-9) знала, що саме відкривати: дотик приходить
       по порожньому місцю рядка, а рядок сам по собі знає лише свою модель. */
    return sectionLabelHtml + header + `
      <div class="${rowCls}" style="${rowStyle}" data-row-cfg="${escapeHtml(cfg.key)}" data-row-model="${escapeHtml(it.model)}" data-row-tile="${escapeHtml(tile.label)}">
        <div class="row-top">
          <div class="row-info">
            <p class="row-name" data-site-list="${cfg.key}" data-site-key="${escapeHtml(siteLinkKey(it))}">${modelHtml(it.model)}</p>
          </div>
          <div class="row-right">
            ${window.Stock ? Stock.slotHtml(it, cfg.key) : ''}
            ${locked ? '' : `
            <button class="cart-check-btn${cartQty > 0 ? ' active' : ''}" type="button" data-key="${escapeHtml(cartKey)}" data-model="${escapeHtml(it.model)}" data-price="${it.price}" data-currency="${escapeHtml(it.currency || '')}" data-tile-label="${escapeHtml(tile.label)}" aria-label="Додати в підбірку"><span class="cart-check-icon">${ic('check', '✓')}</span><span class="cart-check-badge" style="${cartQty > 0 ? '' : 'display:none;'}">${cartQty || ''}</span></button>`}
            <div class="row-price${locked ? ' row-price-locked' : ''}" aria-label="${locked ? 'Ціна доступна після входу' : ''}">${priceStr}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  main.innerHTML = toggleHtml + accessNoticeHtml() + countHtml + (filtered.length ? rowsHtml : '<div class="empty">Нічого не знайдено</div>');
  applySiteLinks();
  if (window.Stock) Stock.paint(main); // наявність з 1С (лише адміни; слот порожній, поки немає даних)
  attachBrandToggleHandlers(main);
  positionBrandSlider(main, activeBrand, prevBrandForSlider);
}

function attachBrandToggleHandlers(main) {
  // [data-brand] — щоб не чіпляти обробник до кнопок "3 перемикачі" вкладки VRF
  // (.brand-toggle-btn там теж використовується для вигляду, але з іншими data-атрибутами,
  // див. attachVrfHandlers).
  main.querySelectorAll('.brand-toggle-btn[data-brand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const brand = btn.getAttribute('data-brand');
      if (brand === activeBrand) return;
      catalogRowsSkipStagger = true;
      brandSliderPrevBrand = activeBrand;
      activeBrand = brand;
      renderCatalogList();
    });
  });
}

