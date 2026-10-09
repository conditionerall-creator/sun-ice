/* Sun-ice — ЗАПУСК: увесь виконуваний код верхнього рівня
   Сюди зібрано навішування обробників, IIFE і блок старту з усіх модулів,
   у НЕЗМІННОМУ порядку. Причина: в одному <script> оголошення функцій
   піднімаються наверх, а між окремими файлами — ні. Тому решта файлів лише
   оголошує, а виконується все тут, коли оголошено вже все.
   Цей файл ОБОВ'ЯЗКОВО підключається ОСТАННІМ. */


/* --- з 01-config.js --- */
if (!ICONS_LUCIDE) swapIconsToEmoji();

/* --- з 04-catalog.js --- */
window.addEventListener('resize', syncStickyHeaderOffset);
(function () {
  const headerEl = document.querySelector('header');
  if (!headerEl) return;
  if (window.ResizeObserver) {
    new ResizeObserver(syncStickyHeaderOffset).observe(headerEl);
  }
  syncStickyHeaderOffset();
})();

/* --- з 05-catalog-custom.js --- */
document.getElementById('series-info-close').addEventListener('click', closeSeriesInfo);
document.getElementById('series-info-backdrop').addEventListener('click', closeSeriesInfo);
document.getElementById('th-ezy-instruction-btn').addEventListener('click', () => {
  document.getElementById('th-ezy-instruction-overlay').classList.add('show');
});
document.getElementById('th-ezy-instruction-close').addEventListener('click', closeThEzyInstruction);
document.getElementById('th-ezy-instruction-backdrop').addEventListener('click', closeThEzyInstruction);
document.getElementById('q-ton-instruction-btn').addEventListener('click', () => {
  document.getElementById('q-ton-instruction-overlay').classList.add('show');
});
document.getElementById('q-ton-instruction-close').addEventListener('click', closeQtonInstruction);
document.getElementById('q-ton-instruction-backdrop').addEventListener('click', closeQtonInstruction);
document.getElementById('register-gate-close').addEventListener('click', closeRegisterGate);
document.getElementById('register-gate-backdrop').addEventListener('click', closeRegisterGate);
document.getElementById('register-gate-cta').addEventListener('click', () => {
  closeRegisterGate();
  cabinetMode = 'register';
  switchTab('cabinet', true);
  renderCurrentTab();
});
document.getElementById('main').addEventListener('click', function(e) {
  if (currentTab !== 'catalog') return;
  // Ціна захована (немає повного доступу) — дотик на саму ціну, калькулятор чи галочку
  // "в підбірку" (усі вони працюють із ціною) показує пропозицію зареєструватись замість
  // звичайної дії. Решта рядка (назва, пошук у Google, "поділитися") лишається робочою.
  /* Єдина дія під замком — кнопка в пояснювальній смужці над списком. У самих рядках
     кнопок більше немає (до 2026-10-08 їх було чотири, і всі вели сюди ж).
     Куди саме вести: пристрій, де вже входили, отримує форму входу, новий — реєстрацію. */
  // «Спробувати ще раз» на екрані невдалого завантаження прайсу.
  if (e.target.closest('#price-retry-btn')) {
    initCatalog();
    return;
  }
  if (e.target.closest('#access-note-cta')) {
    let hadAccount = false;
    try { hadAccount = localStorage.getItem(DEVICE_HAD_ACCOUNT_KEY) === '1'; } catch (err) {}
    cabinetMode = hadAccount ? 'login' : 'register';
    switchTab('cabinet', true);
    renderCurrentTab();
    return;
  }
  /* Запасний шлях: у розділах із власним парсингом (VRF, ККБ, вентиляція, завіси…)
     кнопки в заблокованому рядку ще лишаються — там працює старе вікно реєстрації. */
  if (!hasFullAccess && e.target.closest('.row-locked') && e.target.closest('.row-price-locked, .calc-toggle, .cart-check-btn, .share-btn')) {
    showRegisterGate();
    return;
  }
  const infoHeader = e.target.closest('.segment-header-info');
  if (infoHeader) {
    const info = seriesInfoTexts[Number(infoHeader.getAttribute('data-info-idx'))];
    if (info) {
      openSeriesInfo(info.title, info.text); // текст одразу; фото (якщо є) домалюється нижче
      if (info.getImages) {
        info.getImages().then(images => {
          // Overlay могли встигнути закрити чи відкрити на іншій серії, поки фото
          // вантажилось (unzip — не миттєвий) — домальовуємо, лише якщо це та сама серія.
          if (images.length && document.getElementById('series-info-title').textContent === info.title) {
            openSeriesInfo(info.title, info.text, images);
          }
        });
      }
    }
    return;
  }
  // ⓘ біля рядка "Теплові насоси"/VRF — той самий спливаючий блок "детальніше", що й для
  // заголовків серій, тільки прив'язаний до конкретного товару (склад комплекту, примітка).
  const kitInfoBtn = e.target.closest('.kit-info-btn');
  if (kitInfoBtn) {
    const info = seriesInfoTexts[Number(kitInfoBtn.getAttribute('data-info-idx'))];
    if (info) openSeriesInfo(info.title, info.text);
    return;
  }
  // "За запитом" (VRF GALACTIC) — веде до контактів замість ціни/калькулятора.
  // З 2026-10-08 контакти живуть у розділі "Інфо", окремої вкладки більше немає.
  if (e.target.closest('.price-request-btn')) {
    openContacts(true);
    return;
  }
  /* Дотик по рядку — панель товару (П-9). З 2026-10-09 це стосується ВСЬОГО рядка:
     назви, ціни й порожнього місця (рішення власника — у рядка одна дія). Перехід на
     сайт більше не висить на назві: він живе в панелі кнопкою «На сайт ↗».
     Кнопки, посилання й поля пропускаємо, щоб панель не перехоплювала їхні дотики;
     «Додати» (.cart-check-btn) — це button, тобто панель вона не відкриває. */
  const rowEl = e.target.closest('.row[data-row-model]');
  if (rowEl && !e.target.closest('button, a, input, select, label, .calc-panel-slot')) {
    openProductSheet(rowEl.getAttribute('data-row-cfg'), rowEl.getAttribute('data-row-model'), rowEl.getAttribute('data-row-tile'));
    return;
  }
  const articleLinkBtn = e.target.closest('.row-article-link');
  if (articleLinkBtn) {
    const sku = articleLinkBtn.getAttribute('data-sku');
    if (sku) openSystemairSkuPage(sku);
    return;
  }
  const toggleBtn = e.target.closest('.calc-toggle');
  if (toggleBtn) {
    const rowEl = toggleBtn.closest('.row');
    const panel = rowEl.querySelector('.calc-panel');
    if (panel) {
      const willOpen = !panel.classList.contains('open');
      if (openCalcPanelEl && openCalcPanelEl !== panel) { openCalcPanelEl.classList.remove('open'); closeCalcModePopups(openCalcPanelEl); }
      panel.classList.toggle('open', willOpen);
      if (!willOpen) closeCalcModePopups(panel);
      openCalcPanelEl = willOpen ? panel : null;
      calcPanelOpenedAt = Date.now();
      calcScrollGestureUntil = 0; // «інерція» попереднього гортання не має закривати щойно відкриту панель
      if (willOpen) {
        const input = panel.querySelector('.calc-input');
        if (input) input.focus();
      }
    }
    return;
  }
  if (handleCalcDelegatedClick(e)) return;
  const shareBtn = e.target.closest('.share-btn');
  if (shareBtn) {
    const rowEl = shareBtn.closest('.row');
    const nameEl = rowEl.querySelector('.row-name');
    const panel = rowEl.querySelector('.calc-panel');
    const resultEl = panel ? panel.querySelector('.calc-result') : null;
    const basePriceEl = rowEl.querySelector('.row-price');
    // У .row-price, крім самої ціни, лежить ще дрібна примітка окремим span
    // ("роздрібна"/"дилерська"). У текст для месенджера вона потрапляти не повинна:
    // textContent склеював би її з ціною без пробілу — "1 250 EURроздрібна".
    let basePriceText = '';
    if (basePriceEl) {
      const clone = basePriceEl.cloneNode(true);
      const note = clone.querySelector('.row-price-note');
      if (note) note.remove();
      basePriceText = clone.textContent;
    }
    const priceText = (resultEl ? resultEl.textContent : basePriceText).trim();
    const model = nameEl ? nameEl.textContent.trim() : '';
    const shareText = model + ' — ' + priceText;
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        const oldHTML = shareBtn.innerHTML;
        shareBtn.innerHTML = '✓';
        setTimeout(() => { shareBtn.innerHTML = oldHTML; }, 1200);
      }).catch(() => {});
    }
    return;
  }
  const cartBtn = e.target.closest('.cart-check-btn');
  if (cartBtn) {
    addToCart(cartBtn);
    return;
  }
});
document.getElementById('main').addEventListener('input', handleCalcDelegatedInput);
document.getElementById('refresh-icon').addEventListener('click', handleRefreshClick);
document.getElementById('back-btn').addEventListener('click', function() {
  // Дзеркальний перехід (стиснення в плитку) — тільки коли йдемо з деталей категорії
  // каталогу назад (список моделей / VRF / гілка теплових насосів). Історію як завжди
  // рухає history.back() — той самий popstate-обробник, що й раніше, я не чіпав; просто
  // граю "leave"-анімацію ПЕРЕД викликом history.back(), а не змінюю саму навігацію.
  if (currentTab === 'catalog' && activeTile !== null) {
    playGrowFadeLeave(document.getElementById('back-btn'), () => {
      catalogMenuSkipEnterAnim = true;
      history.back();
    });
  } else {
    history.back();
  }
});
document.addEventListener('click', function(e) {
  // Спершу — спливаюче меню вибору знаку (+/-/%): дотик будь-де поза ним (включно з іншою
  // ділянкою тієї ж відкритої панелі) закриває його. Власну кнопку поточного знаку, яка й
  // відкриває/закриває це саме меню, ігноруємо — нею керує handleCalcDelegatedClick нижче
  // (bubble-фаза), інакше меню закривалось би тут же, не встигнувши відкритись.
  document.querySelectorAll('.calc-mode-wrap.open').forEach(function(wrap) {
    if (wrap.contains(e.target)) return;
    wrap.classList.remove('open');
  });
  if (!openCalcPanelEl) return;
  if (openCalcPanelEl.contains(e.target)) return;
  const rowEl = openCalcPanelEl.closest('.row');
  const ownToggle = rowEl ? rowEl.querySelector('.calc-toggle') : null;
  if (ownToggle && e.target.closest('.calc-toggle') === ownToggle) return;
  closeCalcModePopups(openCalcPanelEl);
  openCalcPanelEl.classList.remove('open');
  openCalcPanelEl = null;
}, true);
document.addEventListener('touchstart', function(e) {
  const t = e.touches[0];
  calcTouchX = t.clientX; calcTouchY = t.clientY; calcTouchMoved = false;
}, { passive: true, capture: true });
document.addEventListener('touchmove', function(e) {
  const t = e.touches[0];
  if (!calcTouchMoved && Math.abs(t.clientX - calcTouchX) + Math.abs(t.clientY - calcTouchY) > 10) calcTouchMoved = true;
  if (calcTouchMoved) calcScrollGestureActive = true;
}, { passive: true, capture: true });
document.addEventListener('touchend', calcTouchEnd, { passive: true, capture: true });
document.addEventListener('touchcancel', calcTouchEnd, { passive: true, capture: true });
document.addEventListener('wheel', function() { calcScrollGestureUntil = Date.now() + 400; }, { passive: true, capture: true });
window.addEventListener('scroll', function() {
  // Невелика затримка після відкриття — інакше авто-прокрутка сторінки до фокусу на
  // мобільній клавіатурі одразу ж закривала б щойно відкриту панель.
  const userScrolling = calcScrollGestureActive || Date.now() < calcScrollGestureUntil;
  if (openCalcPanelEl && userScrolling && Date.now() - calcPanelOpenedAt > 400) {
    closeCalcModePopups(openCalcPanelEl);
    openCalcPanelEl.classList.remove('open');
    openCalcPanelEl = null;
  }
}, { passive: true, capture: true });

/* --- з 06-cart-promo.js --- */
document.getElementById('cart-fab').addEventListener('click', function() {
  const overlay = document.getElementById('cart-panel-overlay');
  if (overlay.classList.contains('show')) closeCartPanel();
  else openCartPanel();
});
document.getElementById('cart-panel-close').addEventListener('click', closeCartPanel);
document.getElementById('cart-panel-backdrop').addEventListener('click', closeCartPanel);
document.getElementById('cart-panel-overlay').addEventListener('input', handleCalcDelegatedInput);
document.getElementById('cart-panel-overlay').addEventListener('click', function(e) {
  if (handleCalcDelegatedClick(e)) return;
  const qtyBtn = e.target.closest('.cart-qty-btn');
  if (qtyBtn) {
    const key = qtyBtn.closest('.cart-item-row').getAttribute('data-key');
    const entry = cart.find(c => c.key === key);
    if (entry) {
      if (qtyBtn.getAttribute('data-op') === 'plus') entry.qty += 1;
      else entry.qty = Math.max(1, entry.qty - 1);
      renderCartPanel();
      renderCartBar();
      syncCartRowBadge(key);
    }
    return;
  }
  const removeBtn = e.target.closest('.cart-item-remove');
  if (removeBtn) {
    const key = removeBtn.closest('.cart-item-row').getAttribute('data-key');
    cart = cart.filter(c => c.key !== key);
    renderCartPanel();
    renderCartBar();
    syncCartRowBadge(key);
    return;
  }
  const clearBtn = e.target.closest('#cart-clear-btn');
  if (clearBtn) {
    cart = [];
    renderCartPanel();
    renderCartBar();
    syncAllCartBadges();
    return;
  }
  const cartShareBtn = e.target.closest('.cart-share-btn');
  if (cartShareBtn) {
    const panel = document.querySelector('.cart-calc-panel');
    const resultEl = panel ? panel.querySelector('.calc-result') : null;
    const totals = cartTotalsByCurrency();
    const priceText = resultEl ? resultEl.textContent.trim() : Object.keys(totals).map(cur => formatCalcAmount(totals[cur], cur)).join(' + ');
    const modelsText = cart.map(c => c.qty > 1 ? c.model + 'x' + c.qty : c.model).join('+');
    const shareText = modelsText + ' — ' + priceText;
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        const oldHTML = cartShareBtn.innerHTML;
        cartShareBtn.innerHTML = '✓';
        setTimeout(() => { cartShareBtn.innerHTML = oldHTML; }, 1200);
      }).catch(() => {});
    }
    return;
  }
});
document.getElementById('rate-edit-btn').addEventListener('click', openRateEditor);
document.getElementById('rate-cancel-btn').addEventListener('click', closeRateEditor);
document.getElementById('rate-save-btn').addEventListener('click', async function() {
  const msg = document.getElementById('rate-edit-msg');
  const usdRaw = document.getElementById('rate-input-usd').value.trim();
  const eurRaw = document.getElementById('rate-input-eur').value.trim();
  const dateRaw = document.getElementById('rate-input-date').value;
  msg.textContent = '';

  // Долар обов'язковий — саме він рахує гривню в калькуляторі.
  const usdVal = parseFloat(usdRaw);
  if (!usdRaw || isNaN(usdVal) || usdVal <= 0) {
    msg.textContent = 'Вкажіть курс долара числом, більшим за нуль.';
    return;
  }
  // Євро довідкове — можна лишити порожнім, але якщо введено, має бути числом.
  let eurVal = null;
  if (eurRaw) {
    eurVal = parseFloat(eurRaw);
    if (isNaN(eurVal) || eurVal <= 0) { msg.textContent = 'Курс євро має бути числом, більшим за нуль.'; return; }
  }
  if (!dateRaw) { msg.textContent = 'Вкажіть дату, від якої діє курс.'; return; }

  this.disabled = true;
  /* ГОЛОВНЕ ВИПРАВЛЕННЯ, і воно має ДВА шари — другий я знайшов, лише перевіривши вживу.

     Шар 1. Раніше тут було
         try { await sb.from('app_settings').upsert(...) } catch (e) {}
     і одразу usdRate = val. Але supabase-js на невдалий запит НЕ кидає виняток — він
     повертає { error }. Тобто catch не спрацьовував ніколи, помилку ніхто не читав, і
     адміністратор бачив у себе новий курс, будучи впевненим, що зберіг, тоді як у решти
     лишався старий.

     Шар 2. Самої перевірки error ВСЕ ОДНО МАЛО. Якщо запис не проходить через RLS
     (наприклад, сесія протухла і людина вже не адміністратор), PostgREST не вважає це
     помилкою: запит успішний, просто оновлено 0 рядків. error буде null — і ми знову
     показали б «Курс збережено». Тому просимо .select(): він повертає рядки, яких
     запит реально торкнувся. Порожньо — значить не зберегли.

     Так само, до речі, мовчки провалювалась галочка «буду мати на увазі» в акціях
     (див. mark_promo_seen) — та сама пастка, інше місце. */
  const { data, error } = await sb.from('app_settings')
    .update({ usd_rate: usdVal, eur_rate: eurVal, rate_effective_date: dateRaw })
    .eq('id', 1)
    .select('id');
  this.disabled = false;

  if (error) {
    msg.textContent = 'Не вдалося зберегти: ' + (error.message || 'спробуйте ще раз');
    return; // форму НЕ закриваємо — інакше це знову виглядало б як успіх
  }
  if (!data || !data.length) {
    msg.textContent = 'Курс не збережено: недостатньо прав. Спробуйте вийти і зайти знову.';
    return;
  }
  // Перечитуємо з бази, а не віримо своїм же числам: ім'я автора й час проставляє
  // тригер на сервері, з клієнта їх не видно.
  await loadExchangeRate();
  closeRateEditor();
  showHeaderToast('Курс збережено', 1600);
});
document.getElementById('main').addEventListener('click', function(e) {
  const target = e.target.closest('[data-action]');
  if (!target || target.tagName === 'SELECT') return;
  const action = target.getAttribute('data-action');
  const id = target.getAttribute('data-id');
  if (action === 'toggle-menu') {
    const card = target.closest('.user-card');
    if (card) card.classList.toggle('open');
    return;
  }
  if (action && id) handleAdminAction(action, id, null);
});
document.getElementById('main').addEventListener('change', function(e) {
  const target = e.target.closest('select[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  const id = target.getAttribute('data-id');
  if (action && id) handleAdminAction(action, id, target.value);
});
sb.auth.onAuthStateChange(function(event, session) {
  if (session) markDeviceHadAccount();
  if (currentTab === 'cabinet' && !suppressCabinetAutoRerender) renderCabinetTab();
  ensureAccessFresh(true);
  autoAttachPushIfGranted();
});
window.addEventListener('popstate', function(event) {
  // Залишки (stock.js): «Назад» закриває відкриту панель/вікно наявності й більше нічого не робить
  if (window.Stock && window.Stock.onBack && window.Stock.onBack(event)) return;
  /* Те саме для панелі товару: «Назад» на телефоні має закривати її, а не перемальовувати
     список під відкритим листом (інакше панель лишалась би висіти поверх). */
  if (document.getElementById('product-sheet-overlay').classList.contains('show')) {
    /* Мінус ОДНА дія: спершу згортаємо розгорнуті характеристики, і лише якщо згортати
       нічого — закриваємо панель. Крок, який щойно витратили на згортання, повертаємо
       назад в історію, щоб наступний «Назад» закрив панель, а не вистрибнув із розділу. */
    if (psCollapseOpenDetails()) {
      history.pushState({ tab: currentTab, tile: activeTile, sheet: 'product' }, '', location.hash);
      return;
    }
    closeProductSheet();
    return;
  }
  /* Те саме для листа пошуку: «Назад» на телефоні має закривати його, а не вистрибувати
     з каталогу з відкритим листом поверх. */
  if (document.getElementById('global-search-overlay').classList.contains('show')) {
    closeGlobalSearch();
    return;
  }
  const state = event.state;
  if (state && state.tab) {
    switchTab(state.tab, false);
    if (state.tab === 'catalog') {
      activeTile = state.tile || null; activeBrand = 'mhi';
      heatpumpsBrand = state.hpBrand || null;
      ventilationBrand = state.vBrand || null;
      chillersCategory = state.chillersCat || null;
      vrfMhiSource = 'outdoor'; vrfGalSide = 'outdoor';
    }
    if (state.tab === 'info') {
      infoSection = state.section || null; infoBrand = state.brand || null;
      mhiCompatFolder = state.compatFolder || null; mhiCompatSheet = state.compatSheet || 'rac';
    }
    renderCurrentTab();
  } else {
    activeTile = null;
    infoSection = null;
    infoBrand = null;
    mhiCompatFolder = null;
    mhiCompatSheet = 'rac';
    heatpumpsBrand = null;
    ventilationBrand = null;
    chillersCategory = null;
    vrfMhiSource = 'outdoor'; vrfGalSide = 'outdoor';
    if (currentTab === 'catalog') renderCatalogView();
    else if (currentTab === 'info') renderInfoTab();
  }
});
document.getElementById('promo-balloon-bubble').addEventListener('click', function () {
  hidePromoBalloon(true);
});
document.getElementById('promo-balloon-close').addEventListener('click', function (e) {
  e.stopPropagation();
  hidePromoBalloon(false);
});

/* --- з 07-access-info.js --- */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  ensureAccessFresh(true);
  /* Курс теж перечитуємо (2026-09-21). До цього він вантажився РАЗ за запуск, в
     initCatalog. PWA на телефоні висить у пам'яті тижнями — адміністратор міняв курс,
     а дилер далі рахував за старим, поки не перезапустить застосунок. */
  if (catalogInitDone) loadExchangeRate();
});
document.getElementById('main').addEventListener('click', function(e) {
  const img = e.target.closest('.promo-image');
  if (img && img.tagName === 'IMG') openImageLightbox(img.src);
});
document.getElementById('main').addEventListener('click', function(e) {
  const btn = e.target.closest('[data-promo-delete]');
  if (!btn) return;
  handleDeletePromo(btn.getAttribute('data-promo-delete'), btn.getAttribute('data-image-url'), btn.getAttribute('data-pdf-url'));
});

/* --- з 09-cabinet.js --- */
window.addEventListener('resize', () => updateNavIndicator(document.querySelector('.nav-btn.active')));

/* --- з 10-crmontage.js --- */
document.getElementById('main').addEventListener('click', function(e) {
  const target = e.target.closest('[data-task-action]');
  if (!target || target.tagName === 'SELECT') return;
  const action = target.getAttribute('data-task-action');
  if (action === 'add') { openTaskForm(null); return; }
  if (action === 'print') { window.print(); return; }
  if (action === 'export-xlsx') { exportInstallerTasksToExcel(); return; }
  if (action === 'suppliers') { openSuppliersPanel(); return; }
  const id = target.getAttribute('data-task-id');
  if (action && id) handleTaskAction(action, id, null);
});
document.getElementById('main').addEventListener('change', function(e) {
  const select = e.target.closest('select[data-task-action]');
  if (select) {
    const action = select.getAttribute('data-task-action');
    const id = select.getAttribute('data-task-id');
    if (action && id) handleTaskAction(action, id, select.value);
    return;
  }
  const checkbox = e.target.closest('input[type="checkbox"][data-task-action="done-toggle"]');
  if (checkbox) {
    const id = checkbox.getAttribute('data-task-id');
    if (id) handleTaskAction('status', id, checkbox.checked ? 'done' : 'planned');
  }
});
attachTimeInputFormatter(document.getElementById('task-field-time'));
attachDigitsOnlyFilter(document.getElementById('task-field-client-phone'));
(function () {
  const debtInput = document.getElementById('task-field-client-debt');
  const debtOkBtn = document.getElementById('task-field-client-debt-ok');
  debtOkBtn.addEventListener('click', () => {
    if (!debtInput.value.trim()) return;
    debtInput.classList.add('input-confirmed');
    debtOkBtn.textContent = '✓';
    debtOkBtn.classList.add('confirmed');
  });
  debtInput.addEventListener('input', () => {
    debtInput.classList.remove('input-confirmed');
    debtOkBtn.textContent = 'OK';
    debtOkBtn.classList.remove('confirmed');
  });
})();
document.getElementById('task-form-close').addEventListener('click', closeTaskForm);
document.getElementById('task-form-backdrop').addEventListener('click', closeTaskForm);
document.getElementById('task-form-submit-btn').addEventListener('click', handleTaskFormSubmit);
document.getElementById('suppliers-close').addEventListener('click', closeSuppliersPanel);
document.getElementById('suppliers-backdrop').addEventListener('click', closeSuppliersPanel);
document.getElementById('supplier-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('supplier-form-error');
  errEl.innerHTML = '';
  const name = document.getElementById('supplier-new-name').value.trim();
  const amount = document.getElementById('supplier-new-amount').value;
  const note = document.getElementById('supplier-new-note').value.trim();
  if (!name) {
    errEl.innerHTML = '<div class="error">Вкажіть назву постачальника.</div>';
    return;
  }
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData ? sessionData.session : null;
  if (!session) {
    errEl.innerHTML = '<div class="error">Сесія закінчилась. Вийдіть і увійдіть знову.</div>';
    return;
  }
  const { error } = await sb.from('installer_suppliers').insert({
    installer_id: session.user.id,
    name: name,
    debt_amount: amount.trim() || null,
    note: note || null
  });
  if (error) {
    errEl.innerHTML = '<div class="error">Не вдалося зберегти. Спробуйте ще раз.</div>';
    return;
  }
  document.getElementById('supplier-new-name').value = '';
  document.getElementById('supplier-new-amount').value = '';
  document.getElementById('supplier-new-note').value = '';
  await loadSuppliers();
  renderSuppliersList();
});
document.getElementById('suppliers-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-supplier-action="delete"]');
  if (!btn) return;
  const id = btn.getAttribute('data-supplier-id');
  if (!confirm('Видалити цього постачальника?')) return;
  const { error } = await sb.from('installer_suppliers').delete().eq('id', id);
  if (!error) { await loadSuppliers(); renderSuppliersList(); }
});
document.getElementById('suppliers-list').addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-supplier-action="amount"]');
  if (!input) return;
  const id = input.getAttribute('data-supplier-id');
  // Лапки прибираємо: це значення повертається в розмітку як value="..." (supplierRowHtml)
  const value = stripQuotes(input.value).trim() || null;
  const { error } = await sb.from('installer_suppliers').update({ debt_amount: value }).eq('id', id);
  if (!error) { await loadSuppliers(); renderSuppliersList(); }
});
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => animateTabSwitch(btn.getAttribute('data-tab')));
});

/* --- з 11-shell-start.js --- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  /* Автоматичний банер відключено — замість нього при першому відкритті показується
     повноекранна пропозиція встановлення (install-gate, див. нижче). */
});
document.getElementById('shortcut-icon').addEventListener('click', triggerAddToHomeScreen);
document.getElementById('install-close-btn').addEventListener('click', () => {
  document.getElementById('install-banner').classList.remove('show');
  localStorage.setItem('sunice_install_dismissed', '1');
});
window.addEventListener('appinstalled', () => {
  if (document.getElementById('install-gate').classList.contains('show')) {
    renderInstallGateInstalled();
  }
});
document.getElementById('notify-banner-btn').addEventListener('click', handleNotifyBannerEnable);
document.getElementById('notify-banner-close').addEventListener('click', () => {
  localStorage.setItem(NOTIFY_BANNER_SNOOZE_KEY, String(Date.now() + NOTIFY_BANNER_SNOOZE_MS));
  updateNotifyBanner();
});
updateNotifyBanner();
(function () {
  const overlay = document.getElementById('img-lightbox-overlay');
  const stage = document.getElementById('img-lightbox-stage');
  const imgEl = document.getElementById('img-lightbox-img');
  const zoomInBtn = document.getElementById('img-lightbox-zoomin');
  const zoomOutBtn = document.getElementById('img-lightbox-zoomout');
  const resetBtn = document.getElementById('img-lightbox-reset');
  const closeBtn = document.getElementById('img-lightbox-close');

  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  let scale = 1, tx = 0, ty = 0;
  const pointers = new Map();
  let pinchStartDist = null;
  let dragStart = null;
  let lastTapTime = 0;

  function applyTransform() {
    imgEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
  }

  function clampScale(s) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

  function resetView() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  window.openImageLightbox = function (url) {
    if (!url) return;
    imgEl.src = url;
    resetView();
    overlay.classList.add('active');
  };

  function closeLightbox() {
    overlay.classList.remove('active');
    imgEl.src = '';
    pointers.clear();
    pinchStartDist = null;
    dragStart = null;
  }

  closeBtn.addEventListener('click', closeLightbox);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay || e.target === stage) closeLightbox();
  });
  zoomInBtn.addEventListener('click', function () { scale = clampScale(scale + 0.5); applyTransform(); });
  zoomOutBtn.addEventListener('click', function () { scale = clampScale(scale - 0.5); applyTransform(); });
  resetBtn.addEventListener('click', resetView);

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  imgEl.addEventListener('pointerdown', function (e) {
    imgEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragStart = { x: e.clientX - tx, y: e.clientY - ty };
    } else if (pointers.size === 2) {
      dragStart = null;
      const pts = Array.from(pointers.values());
      pinchStartDist = dist(pts[0], pts[1]);
    }
  });

  imgEl.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const d = dist(pts[0], pts[1]);
      const m = mid(pts[0], pts[1]);
      if (pinchStartDist) {
        const newScale = clampScale(scale * (d / pinchStartDist));
        tx = m.x - (m.x - tx) * (newScale / scale);
        ty = m.y - (m.y - ty) * (newScale / scale);
        scale = newScale;
        applyTransform();
      }
      pinchStartDist = d;
    } else if (dragStart && pointers.size === 1 && scale > MIN_SCALE) {
      tx = e.clientX - dragStart.x;
      ty = e.clientY - dragStart.y;
      applyTransform();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) {
      dragStart = null;
      const now = Date.now();
      if (now - lastTapTime < 300) {
        if (scale > MIN_SCALE) resetView();
        else { scale = 2.5; applyTransform(); }
      }
      lastTapTime = now;
    }
  }
  imgEl.addEventListener('pointerup', endPointer);
  imgEl.addEventListener('pointercancel', endPointer);
  imgEl.addEventListener('pointerleave', endPointer);

  imgEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    const newScale = clampScale(scale + (e.deltaY < 0 ? 0.3 : -0.3));
    tx = e.clientX - (e.clientX - tx) * (newScale / scale);
    ty = e.clientY - (e.clientY - ty) * (newScale / scale);
    scale = newScale;
    applyTransform();
  }, { passive: false });
})();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
(function chooseStartScreen() {
  if (deviceHasStoredSession()) {
    markDeviceHadAccount();
    history.replaceState({ tab: 'catalog' }, '', '#catalog');
    return;
  }
  let hadAccount = false;
  try { hadAccount = localStorage.getItem(DEVICE_HAD_ACCOUNT_KEY) === '1'; } catch (e) {}
  cabinetMode = hadAccount ? 'login' : 'register';
  switchTab('cabinet', false);
  history.replaceState({ tab: 'cabinet' }, '', '#cabinet');
})();
/* Доступність плиток меню з клавіатури.
   Спостерігач, а не виклик у кожному рендері: плитки малюються в 44 місцях трьох
   файлів, і будь-яке нове місце інакше довелось би не забути. childList без attributes —
   щоб проставляння самих атрибутів не викликало спостерігача повторно. */
markTilesAccessible(document);
new MutationObserver(function () {
  markTilesAccessible(document.getElementById('main'));
}).observe(document.getElementById('main'), { childList: true, subtree: true });

/* Загальний пошук по каталогу (П-8). Лупа в шапці → лист із полем і результатами;
   клік по результату веде В РОЗДІЛ НА САМ РЯДОК (goToGlobalSearchHit → revealFoundRow),
   а не на початок групи — саме через це минулу версію пошуку власник і видалив. */
/* Рядок пошуку в шапці — справжній <button>, тож клавіатура працює сама. */
document.getElementById('header-search').addEventListener('click', openGlobalSearch);
document.getElementById('global-search-close').addEventListener('click', dismissGlobalSearch);
document.getElementById('global-search-backdrop').addEventListener('click', dismissGlobalSearch);
document.getElementById('global-search-input').addEventListener('input', function (e) {
  renderGlobalSearchResults(e.target.value);
});
/* Enter на телефоні ховає клавіатуру й лишає результати перед очима; якщо знайдено
   рівно одне — одразу ведемо туди, це найчастіший випадок точного маркування. */
document.getElementById('global-search-input').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.target.blur();
  if (globalSearchHits.length === 1) goToGlobalSearchHit(globalSearchHits[0]);
});
document.getElementById('global-search-results').addEventListener('click', function (e) {
  const hit = e.target.closest('[data-hit-idx]');
  if (hit) goToGlobalSearchHit(globalSearchHits[Number(hit.getAttribute('data-hit-idx'))]);
});

/* Панель товару: закриття й дії всередині. Усе, що раніше жило кнопками в рядку прайсу
   (розрахунок, «поділитися», наявність), працює ТУТ — у рядку лишилась тільки «Додати». */
/* Хрестик і підложка йдуть ЧЕРЕЗ ІСТОРІЮ (dismiss), а не закривають панель напряму:
   інакше запис, який зробило відкриття, лишався б в історії сміттям. Див. коментар
   біля dismissProductSheet() у js/12-product-sheet.js. */
document.getElementById('product-sheet-close').addEventListener('click', dismissProductSheet);
document.getElementById('product-sheet-backdrop').addEventListener('click', dismissProductSheet);

/* Усі дії панелі товару. З 2026-10-09 вони працюють ТУТ, а не натискають сховані
   кнопки рядка прайсу, як робив тимчасовий місток попередньої версії. */
document.getElementById('product-sheet-body').addEventListener('click', function (e) {
  if (!psState) return;
  const t = e.target;

  const tabBtn = t.closest('[data-ps-tab]');
  if (tabBtn) { psState.tab = tabBtn.getAttribute('data-ps-tab'); psRenderTabBody(); psSyncTabs(); return; }

  // «Додаткові розрахунки»: знижка сумою, націнка, кількість, скидання.
  if (t.closest('[data-ps-adv]')) {
    psState.adv = !psState.adv;
    psRenderTabBody();
    return;
  }

  if (t.closest('[data-ps-reset]')) {
    psState.disc = NaN; psState.mark = NaN; psState.qty = 1;
    psState.discKind = 'pct'; psState.markKind = 'pct';
    psRenderTabBody();
    return;
  }

  const curBtn = t.closest('[data-ps-cur]');
  if (curBtn) {
    const next = curBtn.getAttribute('data-ps-cur');
    /* Якщо введена СУМА (а не відсоток) — переводимо і її. Інакше «знижка 15 $» при
       перемиканні на гривню мовчки ставала «знижка 15 ₴», тобто в 45 разів меншою:
       підсумок стрибав, і людина не розуміла чому. Відсотка це не стосується. */
    if (psState.discKind === 'flat' && !isNaN(psState.disc) && psState.disc > 0) {
      psState.disc = Math.round(convertAmount(psState.disc, psState.cur, next, usdRate) * 100) / 100;
    }
    if (psState.markKind === 'flat' && !isNaN(psState.mark) && psState.mark > 0) {
      psState.mark = Math.round(convertAmount(psState.mark, psState.cur, next, usdRate) * 100) / 100;
    }
    psState.cur = next;
    psRenderTabBody();
    return;
  }

  const dk = t.closest('[data-ps-disckind]');
  if (dk) { psState.discKind = dk.getAttribute('data-ps-disckind'); psRenderTabBody(); return; }
  const mk = t.closest('[data-ps-markkind]');
  if (mk) { psState.markKind = mk.getAttribute('data-ps-markkind'); psRenderTabBody(); return; }

  const qtyBtn = t.closest('[data-ps-qty]');
  if (qtyBtn) {
    psState.qty = Math.max(1, psState.qty + (qtyBtn.getAttribute('data-ps-qty') === '+' ? 1 : -1));
    const inp = document.querySelector('.ps-qty-input');
    if (inp) inp.value = psState.qty;
    psUpdateResult();
    return;
  }

  if (t.closest('[data-ps-send]')) {
    const text = shareText();
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { showHeaderToast('Скопійовано'); });
    return;
  }
});

/* Галочка «додати посилання» — change, а не click: так ловиться і клавіатура.
   Перемальовуємо лише попередній перегляд, щоб нічого не стрибало. */
document.getElementById('product-sheet-body').addEventListener('change', function (e) {
  if (!psState) return;
  if (e.target.matches('[data-ps-link]')) {
    psState.withLink = e.target.checked;
    const pv = document.getElementById('ps-share-preview');
    if (pv) pv.textContent = shareText();
  }
});

/* Ввід чисел — окремо від кліків: перемальовуємо лише результат, щоб у полі не
   стрибав курсор і не закривалась екранна клавіатура. */
document.getElementById('product-sheet-body').addEventListener('input', function (e) {
  if (!psState) return;
  if (e.target.id === 'ps-disc') { psState.disc = parseFloat(e.target.value); psUpdateResult(); return; }
  if (e.target.id === 'ps-mark') { psState.mark = parseFloat(e.target.value); psUpdateResult(); return; }
  if (e.target.classList.contains('ps-qty-input')) {
    const n = parseInt(e.target.value, 10);
    psState.qty = (isNaN(n) || n < 1) ? 1 : n;
    psUpdateResult();
  }
});

/* «Усі характеристики» (і групи всередині) мусять ВІДРЕАГУВАТИ, а не тихо дописати
   рядки за межами екрана — власник не бачив, що щось відкрилось (2026-10-09).
   Три речі одразу: панель виростає на весь екран, розкритий блок плавно під'їжджає
   під заголовок і коротко підсвічується. toggle не булькає, тому слухаємо в capture. */
document.addEventListener('toggle', function (e) {
  const d = e.target;
  if (!d || !d.matches || !d.matches('#product-sheet-body details')) return;
  const sc = document.querySelector('#product-sheet-body .ps-tabbody');
  if (!d.open) return;
  document.getElementById('product-sheet-overlay').classList.add('sheet-tall');
  if (!sc) return;
  // через getBoundingClientRect, а не offsetTop: offsetTop не враховує поточну
  // прокрутку контейнера, і блок з'їжджав не туди
  const top = sc.scrollTop + (d.getBoundingClientRect().top - sc.getBoundingClientRect().top) - 6;
  if (sc.scrollTo) sc.scrollTo({ top: top, behavior: 'smooth' }); else sc.scrollTop = top;
  const body = d.querySelector('.ps-all-body, .ps-spec-table');
  if (body) {
    body.classList.remove('ps-reveal');
    void body.offsetWidth;            // перезапуск анімації, якщо клас уже був
    body.classList.add('ps-reveal');
  }
}, true);

/* Прокрутка в будь-якому листі (панель товару, «детальніше», інструкції) — лист
   розкривається вище й показує більше (прохання власника 2026-10-09). Повертається до
   звичайного розміру, коли прокрутили назад догори. scroll не булькає — capture. */
document.addEventListener('scroll', function (e) {
  const sc = e.target;
  if (!sc || !sc.closest) return;
  const ov = sc.closest('.info-sheet-overlay');
  if (!ov) return;
  if (sc.scrollTop > 12) ov.classList.add('sheet-tall');
  else if (sc.scrollTop <= 2) ov.classList.remove('sheet-tall');
}, true);

/* Лист, відкритий повторно, не повинен починатися вже розтягнутим: вміст у ньому
   новий і прокрутка — на початку. Клас 'show' ставлять з півдесятка різних функцій,
   тому стежимо за ним спостерігачем, а не правимо кожну. */
document.querySelectorAll('.info-sheet-overlay').forEach(function (ov) {
  let wasShown = ov.classList.contains('show');
  new MutationObserver(function () {
    const now = ov.classList.contains('show');
    // скидаємо РІВНО в момент відкриття: інакше спостерігач ловив би й власне
    // додавання 'sheet-tall' під час прокрутки й одразу його знімав
    if (now && !wasShown) ov.classList.remove('sheet-tall');
    wasShown = now;
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
});

ensureAccessFresh(true);
updateNavIndicator(document.querySelector('.nav-btn.active'));
renderCurrentTab();
showInstallGate();
checkPromoBalloon();
