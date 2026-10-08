/* Sun-ice — Доступ до цін, контакти, тех. інформація
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Доступ до цін (розділ "Каталог") ----------
   Ціни бачать лише ті, хто увійшов у застосунок і має акаунт (profiles), окрім явно
   заблокованих/відхилених — саме так реалізовано "негайний доступ при реєстрації": як
   тільки заявка подана (status = 'pending'), profiles-рядок уже існує і людина одразу
   бачить ціни, а адмін пізніше або підтверджує (approved), або блокує/відхиляє — і саме
   ця дія миттєво (при наступному відкритті/перевірці) знову ховає ціни. Гостям (без
   сесії) ціни завжди заховані. */
const PRICE_ACCESS_DENIED_STATUSES = ['blocked', 'rejected'];

/* Чи можна показувати ціни власникові цього профілю. Два випадки відмови:
   1) status 'blocked'/'rejected' — адмін закрив доступ;
   2) status 'pending' І непорожній reregistered_at — людина щойно змінила пароль через
      "Забули пароль", і доступ до цін чекає підтвердження адміністратора («варіант з
      підтвердженням», погоджено з користувачем 2026-09-19).
   Звичайна НОВА реєстрація теж 'pending', але в неї reregistered_at порожній — вона, як
   і раніше, бачить ціни одразу, це свідома поведінка застосунку.
   Окремий статус на кшталт 'pending_reset' навмисно не заводили: пара полів дає той
   самий результат без міграції БД і без ризику наштовхнутись на CHECK-обмеження колонки
   status. Серверна половина цієї логіки — Edge Function reregister-user, копія коду в
   claude/edge-functions/reregister-user/index.ts. */
function profileAllowsPrices(profile) {
  if (!profile) return false;
  if (PRICE_ACCESS_DENIED_STATUSES.includes(profile.status)) return false;
  if (profile.status === 'pending' && profile.reregistered_at) return false;
  return true;
}
let hasFullAccess = false;
let lastAccessCheckAt = 0;
let accessCheckInFlight = null;

/* Те, що показується замість ціни, коли доступу немає. Саме текст у розмітці, а не
   CSS-ефект поверх цифри: справжньої ціни в DOM бути не повинно. */
const PRICE_HIDDEN_TEXT = '—';

/* Не частіше одного мережевого запиту на хвилину — щоб перевірка при кожному вході в
   каталог не била по Supabase. force: true (повернення в застосунок, вхід/вихід,
   старт) обходить це обмеження. */
const ACCESS_RECHECK_MS = 60 * 1000;

/* Останній ПІДТВЕРДЖЕНИЙ мережею стан доступу + мітка часу. Навіщо зберігати: перевірка
   доступу — мережевий запит, і до 2026-09-19 будь-який збій зв'язку трактувався як
   "доступу немає". Тобто офлайн ціни зникали у ВСІХ, включно з нормальними дилерами,
   хоча прайс кешується на пристрій саме заради офлайну. Тепер без мережі діє останній
   підтверджений стан, але не довше ACCESS_OFFLINE_GRACE_MS. */
const ACCESS_STATE_KEY = 'sunice_access_state';
/* 7 діб: монтажник на об'єкті без зв'язку прайс не втрачає, а заблокований, який просто
   вимкнув інтернет, протримається щонайбільше тиждень. Строк погоджено 2026-09-19. */
const ACCESS_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function storedAccessAllows() {
  try {
    const st = JSON.parse(localStorage.getItem(ACCESS_STATE_KEY) || 'null');
    if (!st || st.allowed !== true || !st.at) return false;
    return (Date.now() - st.at) <= ACCESS_OFFLINE_GRACE_MS;
  } catch (e) { return false; }
}
function persistAccessState(allowed) {
  try { localStorage.setItem(ACCESS_STATE_KEY, JSON.stringify({ allowed: !!allowed, at: Date.now() })); } catch (e) {}
}

/* Стирає збережений на пристрої прайс — щойно мережа ПІДТВЕРДИЛА, що доступу немає
   (блокування, видалення облікового запису, вихід). До 2026-09-19 копія лишалась у
   localStorage назавжди, тому заблокований фактично зберігав ціни на телефоні.
   sheetsData у пам'яті навмисно не чіпаємо: список моделей (без цін) показується й
   гостям, а перемальовка однаково піде вже з PRICE_HIDDEN_TEXT. */
function dropPriceCache() {
  try {
    /* Не просто стираємо: якщо розібраний прайс уже є в пам'яті, лишаємо на пристрої
       копію БЕЗ цін. Інакше заблокований при наступному запуску качав би 10-мегабайтний
       price.xlsx заново тільки заради назв моделей. priceDataStripped тут НЕ ставимо:
       у пам'яті поточного сеансу ціни ще є, і якщо адмін одразу розблокує — перекачувати
       нічого не треба. */
    if (sheetsData && Object.keys(sheetsData).length) {
      localStorage.setItem('sunice_price_cache', JSON.stringify({
        data: stripPricesFromSheets(sheetsData), version: priceVersion,
        savedAt: Date.now(), parserVersion: PARSER_VERSION, stripped: true
      }));
    } else {
      localStorage.removeItem('sunice_price_cache');
    }
  } catch (e) {
    try { localStorage.removeItem('sunice_price_cache'); } catch (e2) {}
  }
}

/* Збій зв'язку чи певна відповідь сервера? PostgREST на відсутній рядок profiles
   (видалений користувач) віддає error.code = 'PGRST116' — це ВІДПОВІДЬ, і доступу
   справді немає. А "Failed to fetch" без коду — збій мережі, і тоді міняти статус не
   можна, інакше знову зламаємо офлайн. */
function isOfflineError(error) {
  if (navigator.onLine === false) return true;
  if (!error) return false;
  if (error.code) return false;
  return /fetch|network|load failed/i.test(error.message || '');
}

async function refreshAccessState(opts) {
  opts = opts || {};
  if (opts.force !== true && lastAccessCheckAt && (Date.now() - lastAccessCheckAt) < ACCESS_RECHECK_MS) {
    return hasFullAccess;
  }
  /* Один запит на всіх, хто попросив перевірку одночасно: на старті її викликає і сам
     блок "Старт", і renderCurrentTab() для каталогу. */
  if (accessCheckInFlight) return accessCheckInFlight;
  accessCheckInFlight = (async function () {
    let confirmed = false; // чи була відповідь від сервера, а не збій мережі
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const session = sessionData ? sessionData.session : null;
      if (!session) {
        hasFullAccess = false;
        confirmed = true; // немає сесії — це певна відповідь, не збій зв'язку
      } else {
        const { data: profile, error } = await sb.from('profiles').select('status, reregistered_at').eq('id', session.user.id).single();
        if (error && isOfflineError(error)) {
          hasFullAccess = storedAccessAllows();
        } else {
          hasFullAccess = profileAllowsPrices(profile);
          confirmed = true;
        }
      }
    } catch (e) {
      hasFullAccess = storedAccessAllows();
    }
    if (confirmed) {
      persistAccessState(hasFullAccess);
      if (!hasFullAccess) dropPriceCache();
    }
    lastAccessCheckAt = Date.now();
    return hasFullAccess;
  })();
  try { return await accessCheckInFlight; } finally { accessCheckInFlight = null; }
}

/* Перевіряє доступ і, якщо він змінився, одразу прибирає (чи повертає) ціни на
   відкритому екрані й скидає підбірку — у ній лежать ціни доданих позицій. */
async function ensureAccessFresh(force) {
  const before = hasFullAccess;
  await refreshAccessState({ force: force === true });
  if (hasFullAccess === before) return hasFullAccess;
  if (!hasFullAccess) cart = [];
  /* Перше підтвердження доступу за цей запуск — саме тут піднімаємо збережену підбірку
     з пристрою. Раніше не можна: у підбірці ціни, і поки доступ не підтверджено, ми не
     маємо права їх відновлювати. Прапорець — щоб повторний перехід "немає доступу →
     є доступ" не воскресив підбірку, яку щойно свідомо скинули. */
  if (hasFullAccess && !cartRestored) { cartRestored = true; loadStoredCart(); }
  /* Доступ з'явився (підтвердили заявку, розблокували, увійшли), але в пам'яті лежить
     копія прайсу без цін — показувати нема чого, треба перекачати. */
  if (hasFullAccess && priceDataStripped) { reloadPriceAfterAccessGranted(); return hasFullAccess; }
  if (currentTab === 'catalog' && activeTile) renderCatalogList();
  renderCartBar();
  return hasFullAccess;
}

async function reloadPriceAfterAccessGranted() {
  setCatalogStatus('Завантаження прайсу...');
  priceDownloadInFlight = true;
  try {
    const meta = await checkPriceVersion();
    await downloadAndParsePrice(meta ? meta.version : null);
    priceVersion = meta ? meta.version : priceVersion;
    persistProcessedCache(priceVersion);
    setCatalogStatus(priceVersionLabel(priceVersion) || 'Прайс завантажено');
  } catch (e) {
    setCatalogStatus('Немає підключення. Ціни з\'являться після виходу в мережу.');
  } finally {
    priceDownloadInFlight = false;
  }
  if (currentTab === 'catalog') renderCatalogView();
  renderCartBar();
}

/* Повернення в застосунок — привід перевірити доступ негайно. PWA на телефоні тижнями
   висить у пам'яті; до 2026-09-19 стан рахувався лише на старті та при вході/виході,
   тому про блокування людина дізнавалась аж коли supabase-js оновить токен (до години). */

/* Спливаюча картка "Зареєструйтесь" — при дотику на заховану ціну/калькулятор. */
function showRegisterGate() {
  document.getElementById('register-gate-overlay').classList.add('show');
}
function closeRegisterGate() {
  document.getElementById('register-gate-overlay').classList.remove('show');
}

async function renderPromotionsTab() {
  document.getElementById('title').textContent = 'Акції';
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження...</div>';
  clearNotificationsAndBadge();
  hidePromoBalloon(false); // користувач і так зараз відкриває Акції — кулька більше не потрібна

  const [role, promoResult, promoAck] = await Promise.all([
    getCurrentProfileRole(),
    sb.from('promotions').select('*').eq('is_active', true).order('sort_order', { ascending: false }),
    getPromoAckState()
  ]);
  const { data, error } = promoResult;
  const isSuper = role === 'super_admin';

  if (error) {
    main.innerHTML = '<div class="empty">Не вдалося завантажити акції. Перевірте з’єднання з інтернетом.</div>';
    return;
  }

  // "Буду мати на увазі" — показуємо банер, тільки якщо є активна акція, яку користувач
  // ще не підтвердив (найновіша визначається за id, а не за sort_order — див. коментар
  // у send-promo-push.ts).
  const latestPromoId = data && data.length ? Math.max.apply(null, data.map(function (p) { return p.id; })) : null;
  const showAckBanner = latestPromoId != null && promoAck.ackId !== latestPromoId;

  const uploadHtml = isSuper ? `
    <div class="promo-upload-card">
      <p class="promo-upload-title">Додати акцію (зображення)</p>
      <input type="text" id="promo-title-input" class="admin-search" placeholder="Назва акції">
      <label class="promo-upload-label">Зображення акції (PNG, JPG, WEBP, GIF)</label>
      <input type="file" id="promo-image-input" accept=".png,.jpg,.jpeg,.webp,.gif">
      <button type="button" id="promo-upload-btn" class="promo-upload-btn">Завантажити</button>
      <p id="promo-upload-status" class="promo-upload-status"></p>
    </div>` : '';

  const ackBannerHtml = showAckBanner ? `
    <label class="promo-ack-banner">
      <input type="checkbox" id="promo-ack-checkbox">
      <span>Добре, добре, буду мати на увазі</span>
    </label>` : '';

  const cardsHtml = (!data || data.length === 0)
    ? '<div class="empty">Наразі активних акцій немає.<br>Заходьте пізніше!</div>'
    : data.map(p => `
    <div class="promo-card">
      ${p.image_url ? `<img class="promo-image" src="${escapeHtml(p.image_url)}" alt="" role="button" aria-label="Переглянути зображення">` : ''}
      <div class="promo-body">
        <p class="promo-title">${escapeHtml(p.title)}</p>
        ${p.description ? `<p class="promo-desc">${escapeHtml(p.description)}</p>` : ''}
        ${p.conditions ? `<p class="promo-desc">${escapeHtml(p.conditions)}</p>` : ''}
        ${p.valid_until ? `<p class="promo-meta">Діє до ${escapeHtml(p.valid_until)}</p>` : ''}
        ${p.pdf_url ? `<a class="promo-pdf-link" href="${escapeHtml(p.pdf_url)}" target="_blank" rel="noopener">📄 Умови акції (PDF)</a>` : ''}
        ${isSuper ? `<button type="button" class="promo-delete-btn" data-promo-delete="${p.id}" data-image-url="${escapeHtml(p.image_url || '')}" data-pdf-url="${escapeHtml(p.pdf_url || '')}">🗑 Видалити акцію</button>` : ''}
      </div>
    </div>
  `).join('');

  main.innerHTML = uploadHtml + ackBannerHtml + cardsHtml;

  if (isSuper) {
    document.getElementById('promo-upload-btn').addEventListener('click', handlePromoUpload);
  }
  if (showAckBanner) {
    document.getElementById('promo-ack-checkbox').addEventListener('change', async function (e) {
      if (!e.target.checked) return;
      await ackPromo(latestPromoId, promoAck.session);
      renderPromotionsTab();
    });
  }
}

/* Дозволені формати зображень для акцій: за MIME-типом і, про всяк випадок, за розширенням
   (деякі Android-пікери не завжди коректно проставляють file.type). */
const PROMO_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PROMO_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

function isAllowedPromoImage(file) {
  if (file.type && PROMO_IMAGE_MIME_TYPES.includes(file.type)) return true;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return PROMO_IMAGE_EXTENSIONS.includes(ext);
}

function guessImageContentType(file) {
  if (file.type && PROMO_IMAGE_MIME_TYPES.includes(file.type)) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

async function uploadPromoFile(file) {
  if (!isAllowedPromoImage(file)) {
    throw new Error('Непідтримуваний формат файлу. Дозволені: PNG, JPG, WEBP, GIF.');
  }
  const contentType = guessImageContentType(file);
  const fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { error: uploadError } = await sb.storage.from('promo-pdfs').upload(fileName, file, {
    contentType,
    upsert: false
  });
  if (uploadError) throw uploadError;
  const { data: publicUrlData } = sb.storage.from('promo-pdfs').getPublicUrl(fileName);
  return publicUrlData ? publicUrlData.publicUrl : null;
}

async function handlePromoUpload() {
  const titleInput = document.getElementById('promo-title-input');
  const imageInput = document.getElementById('promo-image-input');
  const statusEl = document.getElementById('promo-upload-status');
  const title = (titleInput.value || '').trim();
  const imageFile = imageInput.files && imageInput.files[0];

  if (!title) { statusEl.textContent = 'Введіть назву акції.'; return; }
  if (!imageFile) { statusEl.textContent = 'Виберіть зображення акції.'; return; }

  statusEl.textContent = 'Завантаження...';
  const btn = document.getElementById('promo-upload-btn');
  btn.disabled = true;

  try {
    const imageUrl = await uploadPromoFile(imageFile);

    const { data: maxRow } = await sb.from('promotions').select('sort_order').order('sort_order', { ascending: false }).limit(1).single();
    const nextSort = maxRow && typeof maxRow.sort_order === 'number' ? maxRow.sort_order + 1 : 1;

    const row = { title, is_active: true, sort_order: nextSort };
    if (imageUrl) row.image_url = imageUrl;

    const { error: insertError } = await sb.from('promotions').insert(row);
    if (insertError) throw insertError;

    statusEl.textContent = 'Готово! Акцію додано.';
    renderPromotionsTab();
  } catch (e) {
    statusEl.textContent = 'Помилка: ' + (e.message || 'не вдалося завантажити.');
    btn.disabled = false;
  }
}

/* ---------- Перегляд зображення акції: наближення/віддалення, панорамування ---------- */

/* ---------- Видалення акції (тільки super_admin) ---------- */
function extractPromoStoragePath(url) {
  if (!url) return null;
  const marker = '/storage/v1/object/public/promo-pdfs/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try { return decodeURIComponent(url.slice(idx + marker.length)); } catch (e) { return url.slice(idx + marker.length); }
}

async function handleDeletePromo(id, imageUrl, pdfUrl) {
  if (!confirm('Видалити цю акцію назавжди? Цю дію не можна скасувати.')) return;
  try {
    const paths = [imageUrl, pdfUrl].map(extractPromoStoragePath).filter(Boolean);
    if (paths.length) {
      /* Не критично, якщо видалення файлу зі сховища не вдасться — головне прибрати запис з БД */
      await sb.storage.from('promo-pdfs').remove(paths).catch(function () {});
    }
    const { error } = await sb.from('promotions').delete().eq('id', id);
    if (error) throw error;
    renderPromotionsTab();
  } catch (e) {
    alert('Не вдалося видалити акцію: ' + (e.message || 'невідома помилка.'));
  }
}


/* ---------- Контакти ---------- */
/* Єдина точка входу в контакти. Окремої вкладки "Контакти" в нижньому меню більше
   немає (2026-10-08) — розділ живе в "Інфо". Сюди ведуть: плитка в "Інфо", кнопка
   "За запитом" у VRF GALACTIC і старі посилання з хешем #contacts.
   switchTab() скидає infoSection, тому ставимо його ПІСЛЯ виклику. */
function openContacts(pushHistory) {
  switchTab('info', false);
  infoSection = 'contacts';
  infoBrand = null;
  const state = { tab: 'info', section: 'contacts', brand: null };
  if (pushHistory) history.pushState(state, '', '#info-contacts');
  else history.replaceState(state, '', '#info-contacts');
  renderInfoTab();
}

async function renderContactsTab() {
  document.getElementById('title').textContent = 'Контакти';
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty">Завантаження...</div>';
  const { data, error } = await sb.from('branches').select('*').order('sort_order');
  if (error || !data) {
    main.innerHTML = '<div class="empty">Не вдалося завантажити контакти. Перевірте з’єднання з інтернетом.</div>';
    return;
  }
  main.innerHTML = data.map(b => `
    <div class="branch-card">
      <p class="branch-name">${escapeHtml(b.name)}</p>
      ${b.address ? `<p class="branch-line">${ic('map-pin', '📍', 'ic-lead')}${escapeHtml(b.address)}</p>` : ''}
      ${(b.phones || []).map(p => `<p class="branch-line">${ic('phone', '📞', 'ic-lead')}<a href="tel:${escapeHtml(p.replace(/[^\d+]/g, ''))}">${escapeHtml(p)}</a></p>`).join('')}
      ${b.email ? `<p class="branch-line">${ic('mail', '✉️', 'ic-lead')}<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a></p>` : ''}
    </div>
  `).join('');
}

/* ---------- Тех. інформація ---------- */
/* «Контакти» — ПЕРШИМ і широкою низькою плиткою (рішення власника 2026-10-08):
   контраст форми на тлі звичайних квадратних фото-плиток має зачепити око одразу,
   бо розділ переїхав сюди з нижнього меню. Плитка графічна (колір + іконка), а не
   фото: вантажиться миттєво, нового файлу не потребує, і суцільний колір серед фото
   і є тим контрастом. */
const INFO_SECTIONS = [
  { id: 'contacts', label: 'Контакти', wide: true, icon: 'phone', sub: 'Адреси, телефони й пошта філій' },
  { id: 'catalogs', label: 'Каталоги', img: 'tile-images/tile-catalogs.webp' },
  { id: 'mhi-errors', label: 'Коди помилок MHI', img: 'tile-images/tile-error-codes.webp' },
  { id: 'mhi-compat', label: 'Сумісність блоків MHI', img: 'tile-images/tilecompat.webp', adminOnly: true },
  { id: 'techinfo', label: 'Технічна інфа' }
];
const MHI_COMPAT_FOLDERS = [
  { id: 'household', label: 'Побутові та мультиспліти', img: 'tile-images/tilecompathousehold.webp' },
  { id: 'semi', label: 'Напівпром', img: 'tile-images/tilecompatsemi.webp' }
];
const INFO_BRANDS = [
  { id: 'mhi', label: 'Mitsubishi Heavy', img: 'tile-images/catalog-preview-mhi.webp' },
  { id: 'galactic', label: 'GALACTIC', img: 'tile-images/catalog-preview-galactic.webp' }
];
/* Посилання на офіційні PDF-каталоги виробників (розділ Інфо → Каталоги) */
const INFO_CATALOG_DOCS = {
  mhi: {
    text: 'Каталог побутових і напівпромислових кондиціонерів Mitsubishi H.I.',
    url: 'https://sun-ice.com.ua/download/catalog/mhi/catalog-mhi-rac-pac.pdf',
    preview: 'tile-images/catalog-preview-mhi.webp'
  },
  galactic: {
    text: 'Актуальний каталог продукції Galactic',
    url: 'https://sun-ice.com.ua/pdf_catalogs/cat_Galactic.pdf',
    preview: 'tile-images/catalog-preview-galactic.webp'
  }
};
/* Позначка "цей каталог уже відкривали на цьому пристрої" — суто локально (localStorage),
   щоб замість кнопки "Завантажити" показати обкладинку і "Відкрити". Це не справжня
   перевірка кешу браузера/диска (це неможливо дізнатись напевно з коду сторінки), а
   практичний замінник: якщо людина вже відкривала файл із цього телефону, найімовірніше
   він і зараз швидко відкриється (або з кешу браузера, або просто повторно завантажиться,
   якщо кеш очистили, — гіршого не станеться). */
function catalogDownloadedKey(brand) { return 'sunice_catalog_dl_' + brand; }
function isCatalogMarkedDownloaded(brand) {
  try { return localStorage.getItem(catalogDownloadedKey(brand)) === '1'; } catch (e) { return false; }
}
function markCatalogDownloaded(brand) {
  try { localStorage.setItem(catalogDownloadedKey(brand), '1'); } catch (e) {}
}
function clearCatalogDownloaded(brand) {
  try { localStorage.removeItem(catalogDownloadedKey(brand)); } catch (e) {}
}

async function renderInfoTab() {
  const backBtn = document.getElementById('back-btn');
  const title = document.getElementById('title');

  if (!infoSection) {
    backBtn.style.display = 'none';
    title.textContent = 'Інфо';
    // adminOnly-пункти (зараз лише "Сумісність блоків MHI") — не просто приховані, а
    // взагалі не рендеряться в меню для звичайного користувача.
    const role = await getCurrentProfileRole();
    const isAdmin = role === 'regional_admin' || role === 'super_admin';
    const visibleSections = INFO_SECTIONS.filter(s => !s.adminOnly || isAdmin);
    renderInfoMenu(visibleSections, (id) => {
      infoSection = id;
      infoBrand = null;
      mhiCompatFolder = null;
      mhiCompatSheet = 'rac';
      history.pushState({ tab: 'info', section: id, brand: null }, '', '#info-' + id);
      renderInfoTab();
    });
    return;
  }

  /* Контакти переїхали з нижнього меню сюди (2026-10-08). Сам екран не змінився —
     це той самий renderContactsTab(), він ставить свій заголовок. */
  if (infoSection === 'contacts') {
    backBtn.style.display = 'flex';
    await renderContactsTab();
    return;
  }

  if (infoSection === 'mhi-errors') {
    backBtn.style.display = 'flex';
    title.textContent = 'Коди помилок MHI';
    renderMhiErrorsScreen();
    return;
  }

  if (infoSection === 'mhi-compat') {
    backBtn.style.display = 'flex';
    await renderMhiCompatFolders();
    return;
  }

  const section = INFO_SECTIONS.find(s => s.id === infoSection);

  if (!infoBrand) {
    backBtn.style.display = 'flex';
    title.textContent = section ? section.label : 'Інфо';
    renderInfoMenu(INFO_BRANDS, (id) => {
      infoBrand = id;
      history.pushState({ tab: 'info', section: infoSection, brand: id }, '', '#info-' + infoSection + '-' + id);
      renderInfoTab();
    });
    return;
  }

  backBtn.style.display = 'flex';
  const brand = INFO_BRANDS.find(b => b.id === infoBrand);
  title.textContent = brand ? brand.label : 'Інфо';
  renderInfoDetail();
}

function renderInfoMenu(items, onSelect) {
  const main = document.getElementById('main');
  const tiles = items.map(item => {
    /* Широка низька плитка (зараз це «Контакти»): на всю ширину сітки, суцільний
       акцентний колір замість фото. Саме несхожість на решту й робить її помітною. */
    if (item.wide) {
      return `
        <div class="menu-tile menu-tile-wide" data-info-id="${escapeHtml(item.id)}">
          <span class="menu-tile-wide-icon">${ic(item.icon || 'phone', '📞')}</span>
          <span class="menu-tile-wide-text">
            <span class="menu-tile-wide-title">${escapeHtml(item.label)}</span>
            ${item.sub ? `<span class="menu-tile-wide-sub">${escapeHtml(item.sub)}</span>` : ''}
          </span>
          <span class="menu-tile-wide-go">${ic('chevron-right', '›')}</span>
        </div>`;
    }
    if (item.img) {
      return `
        <div class="menu-tile menu-tile-photo" data-info-id="${escapeHtml(item.id)}">
          <div class="menu-tile-photo-wrap"><img src="${escapeHtml(item.img)}" alt="" loading="lazy"></div>
          <div class="menu-tile-title">${escapeHtml(item.label)}</div>
        </div>`;
    }
    return `
    <div class="menu-tile" data-info-id="${escapeHtml(item.id)}">
      <div class="menu-tile-row">
        <div class="menu-tile-icon">${escapeHtml(item.label.slice(0, 2).toUpperCase())}</div>
      </div>
      <div class="menu-tile-title">${escapeHtml(item.label)}</div>
    </div>`;
  }).join('');
  main.innerHTML = '<div class="menu-grid">' + tiles + '</div>';
  main.querySelectorAll('.menu-tile[data-info-id]').forEach(el => {
    el.addEventListener('click', () => onSelect(el.getAttribute('data-info-id')));
  });
}

function renderInfoDetail() {
  const main = document.getElementById('main');
  if (infoSection === 'catalogs') {
    const doc = INFO_CATALOG_DOCS[infoBrand];
    if (!doc) { main.innerHTML = '<div class="empty">Немає даних.</div>'; return; }
    const downloaded = isCatalogMarkedDownloaded(infoBrand);
    const body = downloaded ? `
        <a class="info-doc-cached-preview" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener" data-catalog-open="${escapeHtml(infoBrand)}">
          <img src="${escapeHtml(doc.preview)}" alt="">
        </a>
        <p class="info-doc-cached-note">📄 ${escapeHtml(doc.text)}</p>
        <a class="info-doc-btn" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener" data-catalog-open="${escapeHtml(infoBrand)}">Відкрити</a>
        <button type="button" class="info-doc-redownload-btn" data-catalog-redownload="${escapeHtml(infoBrand)}">Файл оновився? Завантажити ще раз</button>
      ` : `
        <a class="info-doc-link" href="${escapeHtml(doc.url)}" download data-catalog-download="${escapeHtml(infoBrand)}">${escapeHtml(doc.text)}</a>
        <a class="info-doc-btn" href="${escapeHtml(doc.url)}" download data-catalog-download="${escapeHtml(infoBrand)}">Завантажити</a>
        <p class="promo-doc-note">Файл каталогу важить десятки мегабайт. Якщо після натискання сторінка виглядає порожньою або нічого не відбувається — натисніть і потримайте посилання/кнопку секунду, у меню, що з'явиться, оберіть «Завантажити посилання» — файл почне завантажуватись стандартним завантажувачем телефону в папку «Завантаження», незалежно від переглядача PDF. Бажано робити це через Wi-Fi.</p>
      `;
    main.innerHTML = `<div class="info-doc-card">${body}</div>`;
    main.querySelectorAll('[data-catalog-download]').forEach(el => {
      el.addEventListener('click', () => markCatalogDownloaded(el.getAttribute('data-catalog-download')));
    });
    const redownloadBtn = main.querySelector('[data-catalog-redownload]');
    if (redownloadBtn) {
      redownloadBtn.addEventListener('click', () => {
        clearCatalogDownloaded(redownloadBtn.getAttribute('data-catalog-redownload'));
        renderInfoDetail();
      });
    }
  } else {
    main.innerHTML =
      '<div class="empty">Розділ у розробці.<br>Найближчим часом тут з’являться технічні характеристики, інструкції та сертифікати.</div>';
  }
}

