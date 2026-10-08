/* Sun-ice — Кастомні розділи (VRF, ККБ, вентиляція, завіси, чиллери, ТН) + фото серій
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Спільний рендер плоского списку цін для кастомних розділів (VRF, Теплові
   насоси HeatGuard/WineGuard/MHI) — та сама розмітка рядка, що й у renderCatalogList(),
   але параметризована: які саме кнопки показувати. Реюзить існуючий делегований клік-
   обробник #main (calc-toggle/share-btn/cart-check-btn/segment-header-info
   спрацьовують так само, бо класи ті самі) — і два нових класи, kit-info-btn та
   price-request-btn, оброблені окремими гілками в тому ж обробнику нижче. */
function buildSimplePriceRowsHtml(items, opts) {
  opts = opts || {};
  const showCalc = opts.showCalc !== false;
  const showShare = opts.showShare !== false;
  const showCart = opts.showCart !== false;
  const cartSourceKey = opts.cartSourceKey || '';
  const tileLabel = opts.tileLabel || '';
  const locked = !hasFullAccess;
  const animateRows = opts.stagger !== false; // той самий stagger, що й у звичайному списку прайсу
  let lastKey = null;

  const rowsHtml = items.map((it, rowIndex) => {
    let header = '';
    const effectiveKey = it.groupLabel || it.groupKey;
    if (effectiveKey && effectiveKey !== lastKey) {
      lastKey = effectiveKey;
      // headerNote — дрібний підпис під заголовком секції, показується під КОЖНИМ
      // заголовком групи однаково (напр. умови вимірювання потужності WineGuard), щоб не
      // повторювати його в кожному рядку товару.
      const noteHtml = opts.headerNote ? `<div class="segment-header-note">${escapeHtml(opts.headerNote)}</div>` : '';
      // groupHeaderInfo — той самий "клікабельний заголовок з описом(+фото)", що й у
      // renderCatalogList() для Спліт-систем, тільки параметризований (ККБ GAL: спільний
      // опис у B4 + фото блоків за серією).
      const groupInfo = opts.groupHeaderInfo ? opts.groupHeaderInfo(effectiveKey, it) : null;
      if (groupInfo) {
        const idx = seriesInfoTexts.length;
        seriesInfoTexts.push({ title: effectiveKey, text: groupInfo.text, getImages: groupInfo.getImages });
        header = `<div class="segment-header segment-header-info" data-info-idx="${idx}" style="${it.color ? 'border-color:' + it.color : ''}">${escapeHtml(effectiveKey)}<span class="segment-header-info-icon">ⓘ</span>${noteHtml}</div>`;
      } else {
        header = `<div class="segment-header" style="${it.color ? 'border-color:' + it.color : ''}">${escapeHtml(effectiveKey)}${noteHtml}</div>`;
      }
    } else if (!effectiveKey) {
      lastKey = null;
    }

    let infoBtnHtml = '';
    /* Склад комплекту містить ціни компонентів і суму — інакше вони витікали б через ⓘ
       повз PRICE_HIDDEN_TEXT. Описи без цін лишаються доступними всім. */
    if (it.breakdownText && !(locked && breakdownHasMoney(it))) {
      const idx = seriesInfoTexts.length;
      seriesInfoTexts.push({ title: it.model, text: it.breakdownText });
      infoBtnHtml = `<button class="kit-info-btn" type="button" data-info-idx="${idx}" aria-label="Детальніше">ⓘ</button>`;
    }

    const rowLocked = locked && !it.onRequest && !it.priceUnknown;
    let rightHtml = infoBtnHtml;
    if (it.priceUnknown) {
      // Клітинка прайсу неоднозначна (напр. один рядок з двома об'єднаними маркуваннями
      // і двома можливими цифрами ціни на різних рядках) — свідомо НЕ вгадуємо, яка з
      // цифр належить якому маркуванню, показуємо прочерк без калькулятора/підбірки.
      rightHtml += `<div class="row-price">−</div>`;
    } else if (it.onRequest) {
      rightHtml += (opts.onRequestLink === false)
        ? `<div class="row-price">За запитом</div>`
        : `<button type="button" class="price-request-btn">За запитом</button>`;
    } else {
      // priceText — готовий рядок ціни від парсера (витратні матеріали: 1,58 EUR). Порожній/відсутній —
      // formatListPrice(): копійки показуються, коли вони є в Excel.
      let priceStr = rowLocked
        ? ic('lock', PRICE_HIDDEN_TEXT)
        : (it.priceText || formatListPrice(it));
      /* Примітка ("· роздрібна") без самої ціни сенсу не має — ховаємо разом з нею. */
      if (opts.priceNote && !rowLocked) priceStr += `<span class="row-price-note">${escapeHtml(opts.priceNote)}</span>`;
      const cartKey = cartSourceKey + '|' + it.model;
      const cartQty = showCart ? cartQtyFor(cartKey) : 0;
      const cartBtnHtml = showCart ? `<button class="cart-check-btn${cartQty > 0 ? ' active' : ''}" type="button" data-key="${escapeHtml(cartKey)}" data-model="${escapeHtml(it.model)}" data-price="${rowLocked ? '' : it.price}" data-currency="${escapeHtml(it.currency || '')}" data-tile-label="${escapeHtml(tileLabel)}" aria-label="Додати в підбірку"><span class="cart-check-icon">${ic('check', '✓')}</span><span class="cart-check-badge" style="${cartQty > 0 ? '' : 'display:none;'}">${cartQty || ''}</span></button>` : '';
      const calcBtnHtml = showCalc ? `<button class="calc-toggle" type="button" aria-label="Розрахувати ціну">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="3" y="1.5" width="18" height="21" rx="3" fill="var(--navy)"/>
                <rect x="6" y="4.5" width="12" height="5" rx="1.1" fill="#EDE6DC"/>
                <rect x="6" y="11.7" width="3.6" height="3.4" rx="0.8" fill="#fff"/>
                <rect x="10.2" y="11.7" width="3.6" height="3.4" rx="0.8" fill="#fff"/>
                <rect x="14.4" y="11.7" width="3.6" height="3.4" rx="0.8" fill="#fff"/>
                <rect x="6" y="16.1" width="3.6" height="3.4" rx="0.8" fill="#fff"/>
                <rect x="10.2" y="16.1" width="3.6" height="3.4" rx="0.8" fill="#fff"/>
                <rect x="14.4" y="16.1" width="3.6" height="3.4" rx="0.8" fill="var(--accent)"/>
              </svg>
            </button>` : '';
      const shareBtnHtml = showShare ? `<button class="share-btn" type="button" aria-label="Поділитися">${ic('share-2', '')}</button>` : '';
      /* Під замком кнопок не лишаємо: усі вони працюють із ціною, якої немає, і раніше
         всі вели в одне й те саме вікно реєстрації. Дія одна — у смужці над списком. */
      rightHtml += rowLocked
        ? `<div class="row-price row-price-locked" aria-label="Ціна доступна після входу">${priceStr}</div>`
        : `${cartBtnHtml}${calcBtnHtml}<div class="row-price">${priceStr}</div>${shareBtnHtml}`;
    }

    const powerHtml = it.power ? `<p class="row-sub">${escapeHtml(it.power)}</p>` : '';
    // Артикул (SYSTEMAIR/FRICO): просто текст, або — коли articleLink — кнопка, що шукає
    // товар за цим SKU на офіційному сайті Systemair (openSystemairSkuPage).
    const articleHtml = it.article
      ? (it.articleLink
          ? `<button type="button" class="row-article-link" data-sku="${escapeHtml(it.article)}">Артикул: ${escapeHtml(it.article)}</button>`
          : `<p class="row-sub">Артикул: ${escapeHtml(it.article)}</p>`)
      : '';
    const calcSlotHtml = (showCalc && !it.onRequest && !it.priceUnknown && !rowLocked)
      ? '<div class="calc-panel-slot">' + buildCalcPanelHtml(it.price, it.currency, formatListPrice(it)) + '</div>'
      : '';

    const rowCls = 'row' + (rowLocked ? ' row-locked' : '') + (animateRows ? ' tile-enter' : '');
    const rowStyle = (it.color ? 'border-left:4px solid ' + it.color + ';border-right:4px solid ' + it.color + ';' : '') + (animateRows ? 'animation-delay:' + (rowIndex * 45) + 'ms;' : '');
    return header + `
      <div class="${rowCls}" style="${rowStyle}">
        <div class="row-top">
          <div class="row-info">
            <p class="row-name">${escapeHtml(it.model)}</p>
            ${powerHtml}
            ${articleHtml}
          </div>
          <div class="row-right">${rightHtml}</div>
        </div>
        ${calcSlotHtml}
      </div>
    `;
  }).join('');
  /* Пояснення «чому немає цін» — один раз зверху списку. opts.append — це дозавантаження
     наступної порції (Systemair/завіси, кнопка «Показати ще»): там смужка не потрібна,
     інакше вона вилізла б посеред списку при кожній порції. */
  return (opts.append ? '' : accessNoticeHtml()) + rowsHtml;
}

/* ---------- "Мультизональні VRF" ---------- */
const VRF_MHI_SOURCES = [
  { key: 'outdoor', label: 'VRF Зовнішні блоки', dataKey: 'vrf_mhi_outdoor' },
  { key: 'indoor_r410a', label: 'VRF Внутрішні R410A', dataKey: 'vrf_mhi_indoor_r410a' },
  { key: 'indoor_kxze1w', label: 'VRF Внутрішні KXZE1-W R32', dataKey: 'vrf_mhi_indoor_kxze1w' }
];
function renderVrfList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  // Той самий прапорець, що й у renderCatalogList() — обов'язково "спожити" тут теж,
  // інакше після перемикання бренду на екрані VRF він лишиться "застряглим" і помилково
  // пригнітить stagger при наступному вході в звичайний (не-VRF) список моделей.
  const animateRows = !catalogRowsSkipStagger;
  const prevBrandForSlider = brandSliderPrevBrand;
  catalogRowsSkipStagger = false;
  brandSliderPrevBrand = null;

  const brandToggleHtml = `
    <div class="brand-toggle brand-toggle-sliding">
      <div class="brand-toggle-slider"></div>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'mhi' ? 'active' : ''}" data-brand="mhi">MHI</button>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'gal' ? 'active' : ''}" data-brand="gal">GAL</button>
    </div>`;

  let subToggleHtml, items, cartSourceKey, opts;
  if (activeBrand === 'mhi') {
    subToggleHtml = '<div class="brand-toggle toggle-3way">' + VRF_MHI_SOURCES.map(s =>
      `<button type="button" class="brand-toggle-btn${vrfMhiSource === s.key ? ' active' : ''}" data-vrf-source="${s.key}">${escapeHtml(s.label)}</button>`
    ).join('') + '</div>';
    const src = VRF_MHI_SOURCES.find(s => s.key === vrfMhiSource);
    items = sheetsData[src.dataKey] || [];
    cartSourceKey = 'vrf_mhi_' + vrfMhiSource;
    // Фото серії — той самий механізм, що й Спліт-системи/ККБ (extractSeriesImages).
    // src.label збігається з реальною назвою аркуша ("VRF Зовнішні блоки" тощо).
    opts = {
      cartSourceKey, tileLabel: 'Мультизональні VRF', showCalc: false, showShare: false, priceNote: 'роздрібна', stagger: animateRows,
      groupHeaderInfo: (effectiveKey) => {
        if (!effectiveKey) return null;
        return {
          text: effectiveKey,
          getImages: async () => {
            const rowGroupMap = await getVrfRowGroupMap(src.label, wb => parseVrfTypeSheet(wb, src.label));
            const map = await extractSeriesImages(src.label, row => rowGroupMap[row]);
            return map.get(effectiveKey) || [];
          }
        };
      }
    };
  } else {
    subToggleHtml = `
      <div class="brand-toggle toggle-3way">
        <button type="button" class="brand-toggle-btn${vrfGalSide === 'outdoor' ? ' active' : ''}" data-vrf-gal-side="outdoor">Зовнішні</button>
        <button type="button" class="brand-toggle-btn${vrfGalSide === 'indoor' ? ' active' : ''}" data-vrf-gal-side="indoor">Внутрішні</button>
      </div>`;
    items = sheetsData[vrfGalSide === 'outdoor' ? 'vrf_gal_outdoor' : 'vrf_gal_indoor'] || [];
    cartSourceKey = 'vrf_gal_' + vrfGalSide;
    const galCacheKey = vrfGalSide === 'outdoor' ? 'galOutdoor' : 'galIndoor';
    const galRebuild = vrfGalSide === 'outdoor' ? parseGalVrfOutdoorSheet : parseGalVrfIndoorSheet;
    opts = {
      cartSourceKey, tileLabel: 'Мультизональні VRF', stagger: animateRows,
      groupHeaderInfo: (effectiveKey) => {
        if (!effectiveKey) return null;
        return {
          text: effectiveKey,
          getImages: async () => {
            const rowGroupMap = await getVrfRowGroupMap(galCacheKey, galRebuild);
            const map = await extractSeriesImages('Galactic VRF', row => rowGroupMap[row]);
            return map.get(effectiveKey) || [];
          }
        };
      }
    };
  }

  if (items.length === 0) {
    main.innerHTML = brandToggleHtml + subToggleHtml + '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
    attachVrfHandlers(main);
    positionBrandSlider(main, activeBrand, prevBrandForSlider);
    return;
  }

  const rowsHtml = buildSimplePriceRowsHtml(items, opts);
  main.innerHTML = brandToggleHtml + subToggleHtml + '<div class="count">Всього: ' + items.length + '</div>' + rowsHtml;
  attachVrfHandlers(main);
  positionBrandSlider(main, activeBrand, prevBrandForSlider);
}
function attachVrfHandlers(main) {
  attachBrandToggleHandlers(main);
  main.querySelectorAll('[data-vrf-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-vrf-source');
      if (key === vrfMhiSource) return;
      vrfMhiSource = key;
      renderVrfList();
    });
  });
  main.querySelectorAll('[data-vrf-gal-side]').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.getAttribute('data-vrf-gal-side');
      if (side === vrfGalSide) return;
      vrfGalSide = side;
      renderVrfList();
    });
  });
}

/* ---------- "Компресорно-конденсаторні блоки (ККБ)" ---------- */
// Сирі рядки аркуша "Galactic ККБ" (для прив'язки фото блоків до серії за regex прямо з
// маркування рядка-анкера — тут не треба stateful rowGroupMap, як для Спліт-систем, бо
// серія й так рахується напряму з тексту кожного рядка). Кешується так само, як priceRawBuffer.
let kkbGalRawRowsCache = null;
async function getKkbGalRawRows() {
  if (kkbGalRawRowsCache) return kkbGalRawRowsCache;
  const buf = await ensurePriceRawBuffer();
  if (!buf) return null;
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheet = wb.Sheets['Galactic ККБ'];
  if (!sheet) return null;
  kkbGalRawRowsCache = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return kkbGalRawRowsCache;
}
function renderKkbList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  const animateRows = !catalogRowsSkipStagger;
  const prevBrandForSlider = brandSliderPrevBrand;
  catalogRowsSkipStagger = false;
  brandSliderPrevBrand = null;

  const brandToggleHtml = `
    <div class="brand-toggle brand-toggle-sliding">
      <div class="brand-toggle-slider"></div>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'mhi' ? 'active' : ''}" data-brand="mhi">MHI</button>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'gal' ? 'active' : ''}" data-brand="gal">GAL</button>
    </div>`;

  let items, opts;
  if (activeBrand === 'mhi') {
    items = sheetsData.kkb_mhi || [];
    opts = { cartSourceKey: 'kkb_mhi', tileLabel: 'Компресорно-конденсаторні блоки (ККБ)', showCalc: false, showCart: false, stagger: animateRows };
  } else {
    items = sheetsData.kkb_gal || [];
    opts = {
      cartSourceKey: 'kkb_gal', tileLabel: 'Компресорно-конденсаторні блоки (ККБ)', showCalc: false, showCart: false, stagger: animateRows,
      // Клікабельний заголовок серії — фото блоків (extractSeriesImages, "Фото" лівіше
      // маркування) + спільний опис із B4 (однаковий для всіх серій).
      groupHeaderInfo: (effectiveKey, it) => {
        if (!it.groupFullText) return null;
        return {
          text: it.groupFullText,
          getImages: async () => {
            const rawRows = await getKkbGalRawRows();
            const map = await extractSeriesImages('Galactic ККБ', row => {
              const m = rawRows && rawRows[row] ? String(rawRows[row][2] || '').trim() : '';
              return m ? extractGucSeries(m) : null;
            });
            return map.get(effectiveKey) || [];
          }
        };
      }
    };
  }

  if (items.length === 0) {
    main.innerHTML = brandToggleHtml + '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
    attachBrandToggleHandlers(main);
    positionBrandSlider(main, activeBrand, prevBrandForSlider);
    return;
  }

  const rowsHtml = buildSimplePriceRowsHtml(items, opts);
  main.innerHTML = brandToggleHtml + '<div class="count">Всього: ' + items.length + '</div>' + rowsHtml;
  attachBrandToggleHandlers(main);
  positionBrandSlider(main, activeBrand, prevBrandForSlider);
}

/* ---------- "Вентиляційне обладнання" ---------- */
const VENTILATION_BRANDS = [
  { key: 'systemair', label: 'Systemair', img: 'tile-images/tile-systemair.webp' }
];
function renderVentilationList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  if (!ventilationBrand) {
    const tilesHtml = VENTILATION_BRANDS.map(b => `
      <div class="menu-tile menu-tile-photo" data-ventilation-brand="${b.key}">
        <div class="menu-tile-photo-wrap"><img src="${escapeHtml(b.img)}" alt="" loading="lazy"></div>
        <div class="menu-tile-title">${escapeHtml(b.label)}</div>
      </div>`).join('');
    main.innerHTML = '<div class="menu-grid">' + tilesHtml + '</div>';
    main.querySelectorAll('[data-ventilation-brand]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-ventilation-brand');
        history.pushState({ tab: 'catalog', tile: 'ventilation', vBrand: key }, '', '#ventilation-' + key);
        ventilationBrand = key;
        systemairSearchQuery = '';
        systemairRenderCount = SYSTEMAIR_BATCH;
        renderVentilationList();
      });
    });
    return;
  }

  // SYSTEMAIR — ~14000 позицій одним плоским списком (весь європейський каталог), без
  // групування за серіями. За проханням користувача весь товар має бути видно списком —
  // але намалювати всі ~14000 DOM-рядків за раз усе одно заморозило б мобільний браузер,
  // тому рендеримо частинами (SYSTEMAIR_BATCH за раз) із кнопкою "Показати ще" внизу —
  // весь список зрештою доступний, просто не всі рядки одразу в DOM. Пошук (за
  // маркуванням чи артикулом) — той самий список, просто звужений фільтром, з тим самим
  // порційним рендером.
  const allItems = sheetsData.systemair || [];
  const q = normalizeSearchKey(systemairSearchQuery);
  const filtered = q.length >= 2
    ? allItems.filter(it => matchesSearchQuery(it.model, q) || matchesSearchQuery(it.article, q))
    : allItems;
  const visibleCount = Math.min(systemairRenderCount, filtered.length);
  const visible = filtered.slice(0, visibleCount);

  // Один об'єкт на обидва місця рендеру рядків (перша порція і докрутка "Показати ще") —
  // раніше це були два окремі літерали, і будь-яка зміна опцій легко розходилась між ними.
  const rowOpts = {
    cartSourceKey: 'systemair', tileLabel: 'Вентиляційне обладнання',
    stagger: false, priceNote: 'роздрібна'
  };

  const searchHtml = `<div class="sticky-search"><div class="admin-search"><input type="text" id="systemair-search-input" placeholder="Пошук за маркуванням або артикулом..." value="${escapeHtml(systemairSearchQuery)}"></div></div>`;
  let bodyHtml;
  if (allItems.length === 0) {
    bodyHtml = '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
  } else if (filtered.length === 0) {
    bodyHtml = '<div class="empty">Нічого не знайдено</div>';
  } else {
    const countText = (q.length >= 2 ? 'Знайдено: ' : 'Всього: ') + filtered.length;
    const loadMoreHtml = visibleCount < filtered.length
      ? `<button type="button" class="load-more-btn" id="systemair-load-more">Показати ще (${filtered.length - visibleCount})</button>`
      : '';
    bodyHtml = `<div class="count" id="systemair-count">${countText}</div><div id="systemair-rows">${buildSimplePriceRowsHtml(visible, rowOpts)}</div>${loadMoreHtml}`;
  }
  main.innerHTML = searchHtml + bodyHtml;
  syncStickyHeaderOffset();
  const input = document.getElementById('systemair-search-input');
  if (input) {
    input.addEventListener('input', () => {
      systemairSearchQuery = stripQuotes(input.value); // лапки ламали б value="..." при перемальовуванні
      systemairRenderCount = SYSTEMAIR_BATCH; // нова умова пошуку — пагінація з початку
      const caret = input.selectionStart;
      renderVentilationList();
      const newInput = document.getElementById('systemair-search-input');
      if (newInput) { newInput.focus(); newInput.setSelectionRange(caret, caret); }
    });
  }
  const loadMoreBtn = document.getElementById('systemair-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      // Дописуємо лише НОВУ порцію рядків у кінець списку (не перемальовуємо все) —
      // інакше клік внизу довгого списку щоразу підкидав би сторінку нагору.
      const prevCount = visibleCount;
      systemairRenderCount += SYSTEMAIR_BATCH;
      const nextCount = Math.min(systemairRenderCount, filtered.length);
      const nextBatch = filtered.slice(prevCount, nextCount);
      const rowsContainer = document.getElementById('systemair-rows');
      if (rowsContainer) {
        rowsContainer.insertAdjacentHTML('beforeend', buildSimplePriceRowsHtml(nextBatch, Object.assign({}, rowOpts, { append: true })));
      }
      if (nextCount >= filtered.length) {
        loadMoreBtn.remove();
      } else {
        loadMoreBtn.textContent = 'Показати ще (' + (filtered.length - nextCount) + ')';
      }
    });
  }
}

/* ---------- "Повітряні завіси" — FRICO ---------- */
let aircurtainsSearchQuery = '';
function renderAirCurtainsList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  // Заголовок екрана дописуємо брендом: renderCatalogView() виставив просто tile.label
  // ДО цього виклику, тому тут його можна перезаписати (так само робить вкладка Інфо).
  // Перемикання бренду знову проходить через renderCatalogList() → сюди, тож заголовок
  // сам стане "REMAK" — окремої логіки не треба. Підпис плитки в каталозі (tile.label)
  // при цьому лишається без бренду.
  document.getElementById('title').textContent =
    'Повітряні завіси ' + (activeBrand === 'mhi' ? 'FRICO' : 'REMAK');

  // FRICO/REMAK — той самий перемикач-механізм, що й ККБ (activeBrand 'mhi'/'gal' як
  // спільний слот A/B, тут просто підписаний інакше в розмітці).
  const brandToggleHtml = `
    <div class="brand-toggle brand-toggle-sliding">
      <div class="brand-toggle-slider"></div>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'mhi' ? 'active' : ''}" data-brand="mhi">FRICO</button>
      <button type="button" class="brand-toggle-btn ${activeBrand === 'gal' ? 'active' : ''}" data-brand="gal">REMAK</button>
    </div>`;
  const prevBrandForSlider = brandSliderPrevBrand;
  brandSliderPrevBrand = null;

  const allItems = (activeBrand === 'mhi' ? sheetsData.frico : sheetsData.remak_curtains) || [];
  const cartSourceKey = activeBrand === 'mhi' ? 'frico' : 'remak_curtains';
  const q = normalizeSearchKey(aircurtainsSearchQuery);
  const filtered = q.length >= 2
    ? allItems.filter(it => matchesSearchQuery(it.model, q) || matchesSearchQuery(it.article, q))
    : allItems;

  const visibleCount = Math.min(aircurtainsRenderCount, filtered.length);
  const visible = filtered.slice(0, visibleCount);
  // Калькулятор по рядку не просили для цієї плитки — лише загальний (checkbox
  // "підбірка"), за спільним правилом "де є ціна (роздрібна теж) — загальний
  // калькулятор додаємо". stagger:false — послідовна анімація на порційний рендер
  // виглядала б як гальма.
  // Один об'єкт на обидва місця рендеру рядків (перша порція і докрутка "Показати ще") —
  // той самий підхід, що й у SYSTEMAIR, щоб опції не розходились між ними.
  const opts = { cartSourceKey, tileLabel: 'Повітряні завіси', showCalc: false, priceNote: 'роздрібна', stagger: false };

  const searchHtml = `<div class="sticky-search"><div class="admin-search"><input type="text" id="aircurtains-search-input" placeholder="Пошук за маркуванням або артикулом..." value="${escapeHtml(aircurtainsSearchQuery)}"></div></div>`;
  let bodyHtml;
  if (allItems.length === 0) {
    bodyHtml = '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
  } else if (filtered.length === 0) {
    bodyHtml = '<div class="empty">Нічого не знайдено</div>';
  } else {
    // Порційний рендер (AIRCURTAINS_BATCH) — той самий підхід, що й SYSTEMAIR: FRICO
    // сам по собі ~1000 позицій, і саме синхронна побудова стількох DOM-рядків одразу
    // при відкритті плитки була причиною помітної затримки (див. коментар біля
    // AIRCURTAINS_BATCH). REMAK — рядків менше за один батч, кнопка "Показати ще" для
    // нього просто не з'явиться.
    const countText = (q.length >= 2 ? 'Знайдено: ' : 'Всього: ') + filtered.length;
    const loadMoreHtml = visibleCount < filtered.length
      ? `<button type="button" class="load-more-btn" id="aircurtains-load-more">Показати ще (${filtered.length - visibleCount})</button>`
      : '';
    bodyHtml = `<div class="count">${countText}</div><div id="aircurtains-rows">${buildSimplePriceRowsHtml(visible, opts)}</div>${loadMoreHtml}`;
  }
  main.innerHTML = brandToggleHtml + searchHtml + bodyHtml;
  attachBrandToggleHandlers(main);
  positionBrandSlider(main, activeBrand, prevBrandForSlider);
  syncStickyHeaderOffset();
  const loadMoreBtn = document.getElementById('aircurtains-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      // Дописуємо лише НОВУ порцію рядків у кінець (не перемальовуємо все) — той самий
      // підхід, що й у SYSTEMAIR, інакше клік внизу довгого списку підкидав би сторінку.
      const prevCount = visibleCount;
      aircurtainsRenderCount += AIRCURTAINS_BATCH;
      const nextCount = Math.min(aircurtainsRenderCount, filtered.length);
      const nextBatch = filtered.slice(prevCount, nextCount);
      const rowsContainer = document.getElementById('aircurtains-rows');
      if (rowsContainer) {
        rowsContainer.insertAdjacentHTML('beforeend', buildSimplePriceRowsHtml(nextBatch, Object.assign({}, opts, { append: true })));
      }
      if (nextCount >= filtered.length) {
        loadMoreBtn.remove();
      } else {
        loadMoreBtn.textContent = 'Показати ще (' + (filtered.length - nextCount) + ')';
      }
    });
  }
  const input = document.getElementById('aircurtains-search-input');
  if (input) {
    input.addEventListener('input', () => {
      aircurtainsSearchQuery = stripQuotes(input.value); // див. коментар у пошуку Systemair
      aircurtainsRenderCount = AIRCURTAINS_BATCH; // нова умова пошуку — пагінація з початку
      const caret = input.selectionStart;
      renderAirCurtainsList();
      const newInput = document.getElementById('aircurtains-search-input');
      if (newInput) { newInput.focus(); newInput.setSelectionRange(caret, caret); }
    });
  }
}

/* ---------- "Чиллери" — Clint (Італія) ----------
   ЄДИНА плитка каталогу на статичних даних, а не з прайсу. Причина: у прайсі на аркуші
   CLINT є лише 4 серії, а дилеру треба бачити весь асортимент, який виробник показує в
   розділі Europe свого сайту. Ціни на чилери в прайсі й так усі "За запитом", тобто
   гнатись за оновленням через прайс тут нічого.

   Дерево повторює сайт: плитка → 6 категорій (фанкойли свідомо не беремо) → рядки
   серій, згруповані підрозділами. Глибше не йдемо: типорозміри й PDF лишаються на
   сайті виробника, туди веде посилання в кінці кожної категорії.

   Потужність — діапазон по серії, як на сайті (там теж діапазон, а не кожен
   типорозмір). Виносні конденсатори — не кВт, а витрата повітря м³/с: так на сайті,
   бо це не холодильна машина.

   Дані зібрані з clint.it розбором HTML (не на око): кількість серій у кожній
   категорії звірена з кількістю посилань на товари на сторінці — 2/35/21/2/11/2 = 73.
   Тексти перекладені українською (на сайті вони російською, місцями англійською, у
   різному регістрі) і скорочені до суті: маркування й потужність дилер читає в рядку,
   а в описі має бути лише те, чим серія відрізняється — тип компресора, вентилятора,
   теплообмінника. Переклад — єдине, що тут зроблено "руками", тому при оновленні
   асортименту простіше перезібрати з сайту, ніж правити по одному рядку. */
const CLINT_DELIVERY_NOTE = 'Термін доставки зі складу в Італії — від 6 до 12 тижнів залежно від моделі';

const CLINT_CATEGORIES = [
  { id: 'residential', label: 'Побутові та комерційні', img: 'tile-images/tile-clint-residential.webp',
    url: 'https://clint.it/ru/products/europe/air-cooled-liquid-chillers-and-heat-pumps-for-residential-light-commercial-application/' },
  { id: 'commercial', label: 'Комерційні та промислові', img: 'tile-images/tile-clint-commercial.webp',
    url: 'https://clint.it/ru/products/europe/air-cooled-liquid-chillers-and-heat-pumps-for-commercial-industrial-application/' },
  // Коротко: повна назва ("...та виносні конденсатори") розсипалась на 4 рядки і в
  // підписі плитки, і в шапці екрана. Що саме входить — видно з підзаголовків усередині.
  { id: 'watercooled', label: 'Водяне охолодження', img: 'tile-images/tile-clint-watercooled.webp',
    url: 'https://clint.it/ru/products/europe/water-cooled-condenserless-liquid-chillers-and-heat-pumps-for-commercial-industrial-application-remote-condensers/' },
  { id: 'rooftop', label: 'Дахові кондиціонери', img: 'tile-images/tile-clint-rooftop.webp',
    url: 'https://clint.it/ru/products/europe/packaged-roof-top-units/' },
  { id: 'condensing', label: 'Компресорно-конденсаторні блоки', img: 'tile-images/tile-clint-condensing.webp',
    url: 'https://clint.it/ru/products/europe/condensing-units/' },
  { id: 'hydronic', label: 'Гідравлічні модулі', img: 'tile-images/tile-clint-hydronic.webp',
    url: 'https://clint.it/ru/products/europe/hydronic-modules/' }
];

/* Рядки: [маркування, потужність, опис]. Порожня потужність = її немає й на сайті. */
const CLINT_SERIES = [
  { cat: 'residential', group: 'Теплові насоси', items: [
    ['CHA/F/ML/WP 52÷92', '19,0–27,0 кВт', 'Виділений тепловий насос повітря/вода для високотемпературної гарячої води. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.']
  ]},
  { cat: 'residential', group: 'Чилери з повітряним охолодженням конденсатора та теплові насоси', items: [
    ['CHA/IG/A 51÷81', '9,7–18,0 кВт', 'Реверсивні, клас А. Інверторні спіральні компресори, осьові вентилятори, пластинчастий теплообмінник, високоефективний EC-інверторний насос.']
  ]},

  { cat: 'commercial', group: 'Теплові насоси', items: [
    ['CHA/K/A/WP 182-P÷604-P', '56,0–197 кВт', 'Виділений тепловий насос повітря/вода, гаряча вода до 55 °C. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHA/F/ML/WP 102-P÷504-P', '32,0–182 кВт', 'Виділений тепловий насос повітря/вода для високотемпературної гарячої води. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHV/P/WP 152-P÷504-P', '48,0–164 кВт', 'Виділений тепловий насос повітря/вода класу А для високотемпературної гарячої води. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHV/P/HE/WP 152-P÷504-P', '50,0–166 кВт', 'Наднизький шум, висока ефективність. Гаряча вода до 70 °C, EC-інверторні осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHA/K/A/WP 726-P÷24012-P', '227–762 кВт', 'Виділений тепловий насос повітря/вода, гаряча вода до 55 °C. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.']
  ]},
  { cat: 'commercial', group: 'Чилери з повітряним охолодженням конденсатора та теплові насоси', items: [
    ['CHA/IK/A 91÷151', '26,0–42,0 кВт', 'Клас А. Інверторні спіральні компресори, осьові вентилятори, пластинчастий теплообмінник.'],
    ['CHA/IK/A 172-P÷574-P', '50,0–179 кВт', 'Клас А. Інверторні спіральні компресори, осьові вентилятори, пластинчастий теплообмінник.'],
    ['CHA/K/AF 182-P÷604-P', '51,0–183 кВт', 'Спіральні компресори, осьові вентилятори, пластинчастий теплообмінник.'],
    ['CHA/K 182-P÷604-P', '48,0–178 кВт', 'Спіральні компресори, осьові вентилятори, пластинчасті теплообмінники.'],
    ['CHA/K 182÷604', '49,0–179 кВт', 'Спіральні компресори, осьові вентилятори, кожухотрубні теплообмінники.'],
    ['CRA/IK/A 51÷131', '12,0–36,0 кВт', 'Для внутрішнього встановлення з повітропроводами. Інверторний спіральний компресор, EC-інверторні вентилятори, пластинчастий теплообмінник.'],
    ['CHV/P/MC 152-P÷756-P', '48,0–220 кВт', 'Спіральні компресори, осьові вентилятори, пластинчасті випарники.'],
    ['CHV/P/HE/MC 152-P÷756-P', '49,0–226 кВт', 'Висока ефективність. EC-інверторні осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHV/H/HE/MC 804-P÷2406-P', '213–600 кВт', 'Клас А. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHV/H/XE/MC 804-P÷2406-P', '223–618 кВт', 'Клас А, повітря/вода. EC-осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHA/IK/A 674-P÷2356-P', '196–668 кВт', 'Клас А. Інверторні спіральні компресори, осьові вентилятори, пластинчастий теплообмінник.'],
    ['CHA/K/AF 726-P÷24012-P', '197–692 кВт', 'Спіральні компресори, осьові вентилятори, пластинчастий теплообмінник.'],
    ['CHA/K 726-P÷36012-P', '199–1051 кВт', 'Спіральні компресори, осьові вентилятори, пластинчасті теплообмінники.'],
    ['CHA/K 726÷36012', '200–1062 кВт', 'Спіральні компресори, осьові вентилятори, кожухотрубні теплообмінники.'],
    ['CHA/H/A 351-P÷1221-P', '79,0–208 кВт', 'Осьові вентилятори, спіральні компресори, кожухотрубний теплообмінник.'],
    ['CHA/H/A 351÷1221', '79,0–211 кВт', 'Осьові вентилятори, інверторний гвинтовий компресор, кожухотрубний теплообмінник.'],
    ['CHA/H/A 1002÷6002', '197–1353 кВт', 'Осьові вентилятори, (інверторний) гвинтовий компресор, кожухотрубний теплообмінник.'],
    ['CHA/Y/A 1302÷6002', '263–1533 кВт', 'Реверсивні. Осьові вентилятори, (інверторні) гвинтові компресори, кожухотрубний теплообмінник.'],
    ['CHA/TTH 1301-1÷4904-1', '262–1340 кВт', 'Турбокомпресори (відцентрові з магнітною левітацією), затоплений кожухотрубний теплообмінник, осьові вентилятори.'],
    ['CHA/TTY 1301-1÷5004-1', '248–1456 кВт', 'Турбокомпресори (відцентрові з магнітною левітацією), затоплений кожухотрубний теплообмінник, осьові вентилятори.']
  ]},
  { cat: 'commercial', group: 'Чилери з природним охолодженням (free cooling)', items: [
    ['CHA/K/FC 182-P÷604-P', '53,0–174 кВт', 'Повітря/вода з природним охолодженням. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHA/K/FC 726-P÷36012-P', '208–1102 кВт', 'Повітря/вода з природним охолодженням. Осьові вентилятори, спіральні компресори, пластинчастий теплообмінник.'],
    ['CHA/H/FC 351-P÷901-P', '82,0–170 кВт', 'Режим природного охолодження. Осьові вентилятори, гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CHA/H/FC 1002÷4802', '232–1144 кВт', 'Режим природного охолодження. Осьові вентилятори, гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CHA/Y/FC 1202-B÷6002-B', '217–1460 кВт', 'Режим природного охолодження. Осьові вентилятори, гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CHA/TTH/FC 1301-1÷4904-1', '279–1386 кВт', 'Природне охолодження. Турбокомпресори (відцентрові з магнітною левітацією), затоплюваний кожухотрубний теплообмінник.'],
    ['CHA/TTY/FC 1301-1÷5004-1', '246–1443 кВт', 'Природне охолодження. Турбокомпресори (відцентрові з магнітною левітацією), затоплюваний кожухотрубний теплообмінник.']
  ]},
  { cat: 'commercial', group: 'Багатофункціональні агрегати для 4-трубних систем', items: [
    ['CHA/K/EP 182-P÷602-P', '49,0–168 кВт', '4-трубна система, повітряне охолодження конденсатора. Осьові вентилятори, спіральні компресори, пластинчасті випарники.'],
    ['CHA/K/EP 604-P÷2004-P', '', '4-трубна система, повітряне охолодження конденсатора. Осьові вентилятори, спіральні компресори, пластинчасті випарники. Потужність на сайті виробника не вказана — уточнюйте.'],
    ['CHA/Y/EP 1352÷4402', '278–1133 кВт', '4-трубна система. EC-інверторні двигуни, інверторні компресори, кожухотрубні теплообмінники.']
  ]},

  { cat: 'watercooled', group: 'Чилери з водяним охолодженням конденсатора та теплові насоси', items: [
    ['CWW/K/WP 31÷151', '13,0–60,0 кВт', 'Реверсивні. Спіральні компресори, пластинчасті теплообмінники.'],
    ['CWW/K 182-P÷604-P', '55,0–195 кВт', 'Спіральні компресори, пластинчасті теплообмінники.'],
    ['CWW/K 182÷604', '57,0–196 кВт', 'Спіральні компресори, кожухотрубні теплообмінники.'],
    ['CWW/K 726-P÷1128-P', '224–383 кВт', 'Спіральні компресори, пластинчасті теплообмінники.'],
    ['CWW/K 726÷1128', '225–375 кВт', 'Спіральні компресори, кожухотрубні теплообмінники.'],
    ['CWW/H/A 351-P÷901-P', '86,0–189 кВт', 'Гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CWW/H/A 1002÷6002', '234–1650 кВт', 'Гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CWW/Y/A 1002-T÷7202-T', '250–2143 кВт', 'Гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CWW/Y 1302-B÷9002-B', '267–2349 кВт', 'Гвинтові компресори, кожухотрубні теплообмінники.'],
    ['CWW/TTH 1701-1÷6606-1', '321–1922 кВт', 'Компресори Turbocor (магнітна левітація), затоплені кожухотрубні теплообмінники. Для роботи з градирнями.'],
    ['CWW/TTH/DR 1701-1÷6606-1', '301–1802 кВт', 'Компресори Turbocor (магнітна левітація), затоплені кожухотрубні теплообмінники. Для роботи з сухими градирнями.'],
    ['CWW/TTY 1601-1÷14406-1', '319–3912 кВт', 'Компресори Turbocor (магнітна левітація), затоплені кожухотрубні теплообмінники. Для роботи з градирнями.'],
    ['CWW/TTY/DR 1601-1÷6204-1', '298–1584 кВт', 'Компресори Turbocor (магнітна левітація), затоплені кожухотрубні теплообмінники. Для роботи з сухими градирнями.']
  ]},
  { cat: 'watercooled', group: 'Чилери з виносними конденсаторами та теплові насоси', items: [
    ['MEA/K 31÷151', '8,5–42,0 кВт', 'Спіральні компресори, пластинчасті теплообмінники.'],
    ['MEA/K 182-P÷604-P', '51,0–176 кВт', 'Спіральні компресори, пластинчасті теплообмінники.'],
    ['MEA/Y 1302-B÷9002-B', '235–2060 кВт', 'Гвинтові компресори, кожухотрубні теплообмінники.']
  ]},
  { cat: 'watercooled', group: 'Виносні конденсатори', items: [
    ['RCA/K 5111÷8222', '1,4–23,0 м³/с', 'Виносний конденсатор з осьовими вентиляторами. Показник — витрата повітря.'],
    ['RCA/K/SSL 6111÷8222', '1,5–18,0 м³/с', 'Наднизький шум. Осьові вентилятори. Показник — витрата повітря.'],
    ['RCA/Y 8141÷9282', '21,0–124 м³/с', 'Виносний конденсатор з осьовими вентиляторами. Показник — витрата повітря.'],
    ['RCA/Y/SSL 8231÷9281', '23,0–76,0 м³/с', 'Наднизький шум. Осьові вентилятори. Показник — витрата повітря.']
  ]},
  { cat: 'watercooled', group: 'Виділені теплові насоси з водяним охолодженням', items: [
    ['CWW/Y/BH 81-P÷1204-P', '37,0–550 кВт', 'Вода/вода для води надвисокої температури. Спіральні компресори, пластинчасті теплообмінники.']
  ]},

  { cat: 'rooftop', group: 'Дахові кондиціонери з подвійними панелями', items: [
    ['RTQ/IK/EC 101÷181', '19,0–42,0 кВт', 'Моноблок із подвійними панелями. Інверторний спіральний компресор, EC-інверторний вентилятор plug-fan.'],
    ['RTA/IK/EC 172÷724', '58,0–252 кВт', 'Інверторні спіральні компресори, вентилятори plug-fan з EC-інверторними двигунами.'],
    ['RTA/IK/EC/MS 172÷724', '58,0–252 кВт', 'Інверторні спіральні компресори, plug-fan з EC-інверторними двигунами, змішувальна камера.'],
    ['RTA/IK/EC/ECO 172÷724', '58,0–252 кВт', 'Інверторні спіральні компресори, plug-fan з EC-інверторними двигунами, економайзер.'],
    ['RTA/IK/EC/ECO/REC-FX 172÷724', '58,0–252 кВт', 'Інверторні спіральні компресори, plug-fan з EC-інверторними двигунами, економайзер, перехреснотічний рекуператор.'],
    ['RTA/IK/EC/ECO/REC-WH 172÷724', '58,0–252 кВт', 'Інверторні спіральні компресори, plug-fan з EC-інверторними двигунами, економайзер, роторний рекуператор.'],
    ['RTA/K/EC 182÷804', '58,0–252 кВт', 'Спіральні компресори, осьові вентилятори або plug-fan з EC-інверторними двигунами.'],
    ['RTA/K/EC/MS 182÷804', '58,0–252 кВт', 'Спіральні компресори, осьові або plug-fan вентилятори, змішувальна камера.'],
    ['RTA/K/EC/ECO 182÷804', '58,0–252 кВт', 'Спіральні компресори, осьові або plug-fan вентилятори, економайзер.'],
    ['RTA/K/EC/ECO/REC-FX 182÷804', '58,0–252 кВт', 'Спіральні компресори, осьові або plug-fan вентилятори, економайзер, перехреснотічний рекуператор.'],
    ['RTA/K/EC/ECO/REC-WH 182÷804', '58,0–252 кВт', 'Спіральні компресори, осьові або plug-fan вентилятори, економайзер, роторний рекуператор.']
  ]},

  { cat: 'condensing', group: 'Компресорно-конденсаторні блоки', items: [
    ['MHA/K 31÷151', '9,2–45,0 кВт', 'Осьові вентилятори, спіральні компресори.'],
    ['MHA/K 182÷604', '51,0–188 кВт', 'Осьові вентилятори, спіральні компресори.']
  ]},

  { cat: 'hydronic', group: 'Окремі гідравлічні модули', items: [
    ['MR 30÷70', '', 'Окремий гідравлічний модуль.'],
    ['MR 1500÷2500', '', 'Окремий гідравлічний модуль із насосною групою.']
  ]}
];

/* Плоский список позицій категорії у форматі, який розуміє buildSimplePriceRowsHtml. */
function clintItemsFor(catId) {
  const items = [];
  CLINT_SERIES.filter(g => g.cat === catId).forEach(g => {
    g.items.forEach(([marking, power, description]) => {
      items.push({
        model: marking,
        power,
        breakdownText: description,
        onRequest: true,
        groupKey: g.group,
        groupLabel: g.group
      });
    });
  });
  return assignGroupColors(items);
}

function renderChillersList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  if (!chillersCategory) {
    const tilesHtml = CLINT_CATEGORIES.map(c => `
      <div class="menu-tile menu-tile-photo" data-clint-cat="${escapeHtml(c.id)}">
        <div class="menu-tile-photo-wrap"><img src="${escapeHtml(c.img)}" alt="" loading="lazy"></div>
        <div class="menu-tile-title">${escapeHtml(c.label)}</div>
      </div>`).join('');
    main.innerHTML = '<div class="count">Clint, Італія · ціни за запитом</div>'
      + '<div class="menu-grid">' + tilesHtml + '</div>'
      + `<div class="instr-note">${escapeHtml(CLINT_DELIVERY_NOTE)}</div>`;
    main.querySelectorAll('[data-clint-cat]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-clint-cat');
        history.pushState({ tab: 'catalog', tile: 'chillers', chillersCat: id }, '', '#chillers-' + id);
        chillersCategory = id;
        renderChillersList();
      });
    });
    return;
  }

  const cat = CLINT_CATEGORIES.find(c => c.id === chillersCategory);
  if (!cat) { chillersCategory = null; renderChillersList(); return; }
  document.getElementById('title').textContent = cat.label;

  const items = clintItemsFor(cat.id);
  // Ціни на чилери — завжди індивідуальні (комплектація, версія, доставка з Італії),
  // тому "За запитом" тут звичайний текст, а не кнопка переходу в Контакти: інакше
  // кожен рядок у списку виглядав би як окрема кнопка й екран став би рябим.
  const opts = {
    tileLabel: 'Чиллери', showCalc: false, showCart: false, showShare: false,
    onRequestLink: false, stagger: false
  };
  main.innerHTML = `<div class="count">Серій: ${items.length} · натисніть ⓘ, щоб побачити опис</div>`
    + buildSimplePriceRowsHtml(items, opts)
    + `<a class="load-more-btn" href="${escapeHtml(cat.url)}" target="_blank" rel="noopener">Дивитись усі моделі на сайті Clint →</a>`;
}

/* ---------- "Витратні матеріали" ---------- */
function renderConsumablesList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];

  document.getElementById('title').textContent = 'Витратні матеріали для монтажу';

  const items = sheetsData.consumables || [];
  if (items.length === 0) {
    main.innerHTML = '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
    return;
  }

  // Калькулятор і підбірка вимкнені свідомо: ціни тут у двох валютах ($ і EUR), а
  // перерахунок у застосунку є лише для $↔₴ (usdRate), курсу EUR немає. Плюс ціни
  // дробові (1,58 EUR) — підбірка їх округлює, тобто показала б неправильну суму.
  const opts = {
    tileLabel: 'Витратні матеріали', showCalc: false, showCart: false,
    priceNote: 'дилерська', stagger: false
  };
  main.innerHTML = `<div class="count">Позицій: ${items.length}</div>`
    + buildSimplePriceRowsHtml(items, opts);
}

/* ---------- "Теплові насоси" ---------- */
// MHI — фото реального теплового насоса MHI; HeatGuard/WineGuard — не фото товару (у прайсі
// немає єдиної "картинки бренду"), а намальований логотип-напис (SVG), за проханням
// користувача — "просто красивий текст великими літерами, як малюнок".
const HEATPUMPS_BRANDS = [
  { key: 'mhi', label: 'MHI', img: 'tile-images/heatpumpsmhi.webp' },
  { key: 'heatguard', label: 'HeatGuard', img: 'tile-images/heatguardlogo.svg' },
  { key: 'wineguard', label: 'WineGuard', img: 'tile-images/wineguardlogo.svg' },
  { key: 'ezyqton', label: 'MHI EZY / Q-ton', img: 'tile-images/heatpumps-ezyqton.webp' }
];
function renderHeatpumpsList() {
  const main = document.getElementById('main');
  openCalcPanelEl = null;
  seriesInfoTexts = [];
  // Кнопки "EZY"/"Q-TON" у шапці стосуються лише плитки EZY/Q-ton — на решті
  // плиток (і в меню вибору бренду нижче) ховаємо обидві.
  document.getElementById('th-ezy-instruction-btn').style.display = heatpumpsBrand === 'ezyqton' ? 'flex' : 'none';
  document.getElementById('q-ton-instruction-btn').style.display = heatpumpsBrand === 'ezyqton' ? 'flex' : 'none';

  if (!heatpumpsBrand) {
    const tilesHtml = HEATPUMPS_BRANDS.map(b => `
      <div class="menu-tile menu-tile-photo" data-heatpumps-brand="${b.key}">
        <div class="menu-tile-photo-wrap"><img src="${escapeHtml(b.img)}" alt="" loading="lazy"></div>
        <div class="menu-tile-title">${escapeHtml(b.label)}</div>
      </div>`).join('');
    main.innerHTML = '<div class="menu-grid">' + tilesHtml + '</div>';
    main.querySelectorAll('[data-heatpumps-brand]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-heatpumps-brand');
        history.pushState({ tab: 'catalog', tile: 'heatpumps', hpBrand: key }, '', '#heatpumps-' + key);
        heatpumpsBrand = key;
        renderHeatpumpsList();
      });
    });
    return;
  }

  let items, opts;
  if (heatpumpsBrand === 'mhi') {
    items = sheetsData.heatpumps_mhi || [];
    opts = { cartSourceKey: 'heatpumps_mhi', tileLabel: 'Теплові насоси', showCalc: false, priceNote: 'роздрібна' };
  } else if (heatpumpsBrand === 'heatguard') {
    items = sheetsData.heatguard || [];
    opts = { cartSourceKey: 'heatguard', tileLabel: 'Теплові насоси', showCalc: false, showCart: false, onRequestLink: false };
  } else if (heatpumpsBrand === 'wineguard') {
    items = sheetsData.wineguard || [];
    opts = {
      cartSourceKey: 'wineguard', tileLabel: 'Теплові насоси',
      priceNote: 'роздрібна', headerNote: 'Потужність вказана при tвн.+10°C, tзов.+35°C'
    };
  } else {
    items = sheetsData.th_ezy_qton || [];
    // Фото зовнішнього блока EZY R290 і внутрішніх блоків — ті самі вбудовані в Excel
    // картинки (extractSeriesImages), що й у Спліт-систем/ККБ, тільки клікабельні лише
    // для цих двох груп (для решти — Q-ton, баки, аксесуари — фото в файлі просто нема).
    const groupsWithPhoto = ['Зовнішній блок теплового насоса EZY повітря-вода R290', 'Внутрішні блоки'];
    opts = {
      cartSourceKey: 'th_ezy_qton', tileLabel: 'Теплові насоси', showCalc: false, priceNote: 'роздрібна',
      groupHeaderInfo: (effectiveKey) => {
        if (!groupsWithPhoto.includes(effectiveKey)) return null;
        return {
          text: '',
          getImages: async () => {
            const rowGroupMap = await getThEzyRowGroupMap();
            const map = await extractSeriesImages('TH MHI – EZY та Qton', row => rowGroupMap[row]);
            return map.get(effectiveKey) || [];
          }
        };
      }
    };
  }

  const rowsHtml = items.length ? buildSimplePriceRowsHtml(items, opts) : '<div class="empty">Прайс для цього розділу ще не завантажено.</div>';
  main.innerHTML = '<div class="count">Всього: ' + items.length + '</div>' + rowsHtml;
}

/* ---------- Фото серій/блоків із вбудованих в Excel картинок (ПОБУТОВІ/GALACTIC/Galactic
   ККБ) ---------- */
async function ensurePriceRawBuffer() {
  if (priceRawBuffer) return priceRawBuffer;
  try {
    const res = await fetch(PRICE_FILE_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    priceRawBuffer = await res.arrayBuffer();
    return priceRawBuffer;
  } catch (e) {
    return null;
  }
}
const IMAGE_EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
async function xmlFromZip(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  const text = await entry.async('string');
  return new DOMParser().parseFromString(text, 'text/xml');
}
/* Повертає Map<groupLabel, blobUrl> для аркуша sheetName — розбір drawings/media робиться
   один раз за сесію (кеш seriesImageCache), reuse вже завантаженого price.xlsx.
   rowToGroup(row0based) — яка серія/група "діяла" на цьому рядку аркуша (те саме, що бачить
   користувач у segment-header при звичайному рендері прайсу) — приходить іззовні, бо для
   різних аркушів рахується по-різному (parseSheet-стан з rowGroupMap чи прямий regex по
   моделі, див. виклики нижче). */
async function extractSeriesImages(sheetName, rowToGroup) {
  if (seriesImageCache[sheetName]) return seriesImageCache[sheetName];
  const promise = (async () => {
    try {
      const buf = await ensurePriceRawBuffer();
      if (!buf) return new Map();
      const zip = await JSZip.loadAsync(buf);

      const wbXml = await xmlFromZip(zip, 'xl/workbook.xml');
      if (!wbXml) return new Map();
      const sheetEls = wbXml.getElementsByTagName('sheet');
      let rid = null;
      for (let i = 0; i < sheetEls.length; i++) {
        if (sheetEls[i].getAttribute('name') === sheetName) { rid = sheetEls[i].getAttribute('r:id'); break; }
      }
      if (!rid) return new Map();

      const wbRelsXml = await xmlFromZip(zip, 'xl/_rels/workbook.xml.rels');
      if (!wbRelsXml) return new Map();
      const relEls = wbRelsXml.getElementsByTagName('Relationship');
      let sheetTarget = null;
      for (let i = 0; i < relEls.length; i++) {
        if (relEls[i].getAttribute('Id') === rid) { sheetTarget = relEls[i].getAttribute('Target'); break; }
      }
      if (!sheetTarget) return new Map();
      const sheetFileName = sheetTarget.split('/').pop();

      const sheetRelsXml = await xmlFromZip(zip, 'xl/worksheets/_rels/' + sheetFileName + '.rels');
      if (!sheetRelsXml) return new Map();
      const sheetRelEls = sheetRelsXml.getElementsByTagName('Relationship');
      let drawingTarget = null;
      for (let i = 0; i < sheetRelEls.length; i++) {
        const type = sheetRelEls[i].getAttribute('Type') || '';
        if (type.indexOf('drawing') !== -1) { drawingTarget = sheetRelEls[i].getAttribute('Target'); break; }
      }
      if (!drawingTarget) return new Map();
      const drawingFileName = drawingTarget.split('/').pop();

      const drawingXml = await xmlFromZip(zip, 'xl/drawings/' + drawingFileName);
      if (!drawingXml) return new Map();
      const anchors = [];
      ['xdr:twoCellAnchor', 'xdr:oneCellAnchor'].forEach(tag => {
        const els = drawingXml.getElementsByTagName(tag);
        for (let i = 0; i < els.length; i++) {
          const anchor = els[i];
          const from = anchor.getElementsByTagName('xdr:from')[0];
          if (!from) continue;
          const rowEl = from.getElementsByTagName('xdr:row')[0];
          const row = rowEl ? parseInt(rowEl.textContent, 10) : null;
          const blip = anchor.getElementsByTagName('a:blip')[0];
          const embedId = blip ? blip.getAttribute('r:embed') : null;
          if (row !== null && embedId) anchors.push({ row, embedId });
        }
      });
      if (!anchors.length) return new Map();

      const drawingRelsXml = await xmlFromZip(zip, 'xl/drawings/_rels/' + drawingFileName + '.rels');
      if (!drawingRelsXml) return new Map();
      const drawRelEls = drawingRelsXml.getElementsByTagName('Relationship');
      const idToImage = {};
      for (let i = 0; i < drawRelEls.length; i++) {
        idToImage[drawRelEls[i].getAttribute('Id')] = drawRelEls[i].getAttribute('Target').split('/').pop();
      }

      // Рядок 0 у всіх аркушах — логотипи/декоративні шапки, не стосуються жодної
      // конкретної серії, свідомо відкидаємо одразу.
      anchors.sort((a, b) => a.row - b.row);
      const withRow0Dropped = anchors.filter(a => a.row !== 0);

      // Значки/бейджі (R410A, R32, Wi-Fi ready тощо) намальовані ОДНИМ і тим самим файлом,
      // повторно вставленим біля десятків різних серій — на відміну від справжнього фото
      // товару, яке в файлі завжди рівно ОДНЕ. Рахуємо, скільки разів кожен image-файл
      // трапляється у ВСЬОМУ аркуші, і відкидаємо все, що повторюється (поріг ">1") —
      // залишаються тільки унікальні, тобто справжні фото. Перевірено на реальних даних
      // (ПОБУТОВІ/GALACTIC): без цього фільтра "фото" серії міг стати банер "РОЗПРОДАЖ!"
      // чи іконка хладагента, що випадково потрапляє в діапазон рядків групи.
      const fileCounts = new Map();
      withRow0Dropped.forEach(a => {
        const f = idToImage[a.embedId];
        if (f) fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      });
      const uniqueAnchors = withRow0Dropped.filter(a => fileCounts.get(idToImage[a.embedId]) === 1);

      // Кілька анкерів однієї групи (напр. кілька окремих фото серії поруч) — усі йдуть у
      // масив, у порядку рядків аркуша (тобто в тому ж порядку, що й в самому Excel).
      const result = new Map();
      for (const a of uniqueAnchors) {
        const imgFile = idToImage[a.embedId];
        if (!imgFile) continue;
        const ext = (imgFile.split('.').pop() || '').toLowerCase();
        const mime = IMAGE_EXT_MIME[ext];
        if (!mime) continue; // напр. .emf — браузер не вміє показати
        const group = rowToGroup(a.row);
        if (!group) continue;
        const entry = zip.file('xl/media/' + imgFile);
        if (!entry) continue;
        const bytes = await entry.async('arraybuffer');
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (!result.has(group)) result.set(group, []);
        result.get(group).push(url);
      }
      return result;
    } catch (e) {
      return new Map();
    }
  })();
  seriesImageCache[sheetName] = promise;
  return promise;
}

/* rowGroupMap для Спліт-систем — на "теплому" вході (прайс узятий з localStorage-кешу,
   без мережевого buildSheetsData() цієї сесії) seriesRowGroupMaps лишається порожнім, бо
   кеш зберігає лише вже розібраний sheetsData, а не цю службову мапу. Тому рахуємо її тут
   самостійно (той самий parseSheet(), ті самі опції з CATALOG_TILES) з сирого буфера
   price.xlsx — незалежно від того, чи був цієї сесії мережевий розбір прайсу. Кешується
   в тому самому seriesRowGroupMaps, тож рахується щонайбільше раз за сесію на бренд. */
async function getRowGroupMapForSplitTile(brand) {
  const cacheKey = 'split_' + brand;
  if (seriesRowGroupMaps[cacheKey]) return seriesRowGroupMaps[cacheKey];
  const buf = await ensurePriceRawBuffer();
  if (!buf) return [];
  const tile = CATALOG_TILES.find(t => t.id === 'split');
  const cfg = tile && tile[brand];
  if (!cfg) return [];
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheet = wb.Sheets[cfg.sheet];
  if (!sheet) return [];
  let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (cfg.splitMarker) rows = sliceBySplitMarker(rows, cfg.splitMarker, cfg.splitSide);
  const result = parseSheet(rows, cfg.highlight, { seriesLabelMode: cfg.seriesLabelMode, labelSequence: cfg.labelSequence });
  seriesRowGroupMaps[cacheKey] = result.rowGroupMap;
  return result.rowGroupMap;
}

/* Третій аргумент — або масив фото (URL з extractSeriesImages, стрічка над текстом), або
   opts-об'єкт { actionLabel, onAction } для кнопки-дії (таблиця сумісності MHI —
   "Виділити рядок/стовпчик", див. attachCompatTableHandlers). Решта викликів (звичайні
   описи серій без фото/кнопки) не передають жодного — обидва блоки лишаються прихованими. */
function openSeriesInfo(title, text, imagesOrOpts) {
  document.getElementById('series-info-title').textContent = title;
  document.getElementById('series-info-body').textContent = text;
  const images = Array.isArray(imagesOrOpts) ? imagesOrOpts : null;
  const opts = Array.isArray(imagesOrOpts) ? null : imagesOrOpts;
  const imagesEl = document.getElementById('series-info-images');
  if (images && images.length) {
    imagesEl.innerHTML = images.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('');
    imagesEl.hidden = false;
  } else {
    imagesEl.innerHTML = '';
    imagesEl.hidden = true;
  }
  const actionsEl = document.getElementById('series-info-actions');
  const actionBtn = document.getElementById('series-info-action-btn');
  if (opts && opts.actionLabel && opts.onAction) {
    actionBtn.textContent = opts.actionLabel;
    actionBtn.onclick = () => { opts.onAction(); closeSeriesInfo(); };
    actionsEl.hidden = false;
  } else {
    actionsEl.hidden = true;
    actionBtn.onclick = null;
  }
  document.getElementById('series-info-overlay').classList.add('show');
}
function closeSeriesInfo() {
  document.getElementById('series-info-overlay').classList.remove('show');
}

function closeThEzyInstruction() {
  document.getElementById('th-ezy-instruction-overlay').classList.remove('show');
}

function closeQtonInstruction() {
  document.getElementById('q-ton-instruction-overlay').classList.remove('show');
}



/* Калькулятор у рядку прайсу сам згортається: дотик поза розкритою формою (в тому числі
   в порожню область того самого рядка), або гортання списку — і панель знову маленька.
   Слухач у фазі "capture", щоб спрацювати ДО кліку по кнопці % іншого рядка (тоді стара
   панель встигає закритись, перш ніж відкриється нова). Власну кнопку %, яка й керує
   відкриттям/закриттям цієї ж панелі, тут навмисно ігноруємо — нею керує toggleBtn-гілка
   вище. */
/* Гортання списку закриває калькулятор лише коли його справді гортає ПАЛЕЦЬ/колесо.
   Раніше будь-який scroll пізніше 400 мс після відкриття закривав панель — на повільних
   телефонах (відео 2026-10-06) клавіатура виїздить довше, браузер сам прокручує сторінку до
   поля вже після цього порогу, і калькулятор одразу ж згортався. Тепер: scroll без жесту
   (авто-прокрутка від клавіатури) ігноруємо. Жест = рух пальця > 10 px (дотик-тап не рахується)
   або колесо; після відпускання ще ~1.2 с «інерції» (fling). */
let calcScrollGestureActive = false, calcScrollGestureUntil = 0, calcTouchX = 0, calcTouchY = 0, calcTouchMoved = false;
function calcTouchEnd() {
  if (calcTouchMoved) calcScrollGestureUntil = Date.now() + 1200;
  calcScrollGestureActive = false; calcTouchMoved = false;
}

