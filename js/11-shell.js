/* Sun-ice — Встановлення, банери, лайтбокс, service worker, БЛОК СТАРТУ
   Частина index.html, винесена 2026-10-08. Підключається звичайним <script src>
   БЕЗ type="module"/defer/async — порядок файлів і спільна область видимості
   обов'язкові. Міняти порядок у index.html не можна. */

/* ---------- Встановлення на головний екран ---------- */
let deferredInstallPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const bannerDismissed = localStorage.getItem('sunice_install_dismissed') === '1';


function showInstallBanner(platform) {
  const banner = document.getElementById('install-banner');
  const textEl = document.getElementById('install-banner-text');
  const actionBtn = document.getElementById('install-action-btn');
  if (platform === 'android') {
    textEl.textContent = 'Встановіть застосунок Sun-ice на головний екран';
    actionBtn.style.display = 'inline-block';
    actionBtn.onclick = async () => {
      banner.classList.remove('show');
      await triggerAddToHomeScreen();
    };
  } else {
    textEl.textContent = 'Щоб встановити застосунок: натисніть «Поділитися» ⬆ внизу екрана → «На екран Домой»';
    actionBtn.style.display = 'none';
  }
  banner.classList.add('show');
}

/* Кнопка "Ярлик" у вкладці Контакти — той самий системний діалог встановлення,
   викликаний вручну (корисно, якщо автоматичний банер з якоїсь причини не показався). */
async function triggerAddToHomeScreen() {
  if (isStandalone) {
    alert('Застосунок уже встановлено на цьому пристрої.');
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('shortcut-icon').style.opacity = '0.5';
    return;
  }
  if (isIOS) {
    alert('Щоб встановити застосунок на iPhone/iPad: натисніть кнопку «Поділитися» ⬆ внизу екрана Safari → «На екран Домой».');
    return;
  }
  alert('Браузер поки не пропонує швидке встановлення (можливо, застосунок вже додавався раніше, або сторінку щойно відкрито). Спробуйте: меню браузера (⋮) → «Додати на головний екран» / «Встановити застосунок».');
}


/* ---------- Пропозиція встановити застосунок при першому відкритті ---------- */
const INSTALL_GATE_SKIP_KEY = 'sunice_continue_in_browser';

function installGateIconHtml() {
  const iconLink = document.querySelector('link[rel="icon"]');
  const src = iconLink ? iconLink.getAttribute('href') : '';
  return '<div class="install-gate-appicon"><img src="' + src + '" alt=""></div>';
}

function installGateHeaderHtml() {
  return (
    '<div class="install-gate-row">' +
    installGateIconHtml() +
    '<div class="install-gate-appinfo">' +
    '<div class="install-gate-appname">Sun-ice</div>' +
    '<div class="install-gate-appsub">sun-ice.com.ua • Застосунок</div>' +
    '</div></div>'
  );
}

function setInstallGateSheet(html) {
  document.getElementById('install-gate-sheet').innerHTML = html;
}

function closeInstallGate() {
  document.getElementById('install-gate').classList.remove('show');
}

function detectInAppBrowserName() {
  const ua = navigator.userAgent || '';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/Viber/i.test(ua)) return 'Viber';
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  return null;
}

function renderInstallGateConfirmSkip() {
  setInstallGateSheet(
    '<p class="install-gate-desc"><strong>Якщо продовжити в браузері:</strong></p>' +
    '<ul class="install-gate-list">' +
    '<li>не приходитимуть push-сповіщення про нові акції та статус заявки;</li>' +
    '<li>доведеться щоразу заново відкривати сайт через браузер, а не одним дотиком з головного екрана.</li>' +
    '</ul>' +
    '<p class="install-gate-desc">Каталог, акції, кабінет і контакти працюватимуть так само — це лише менш зручний спосіб.</p>' +
    '<button type="button" class="install-gate-install-btn" id="install-gate-back-to-install-btn">Все ж встановити</button>' +
    '<button type="button" class="install-gate-skip-btn" id="install-gate-skip-btn">Продовжити в браузері</button>'
  );
  document.getElementById('install-gate-back-to-install-btn').addEventListener('click', renderInstallGateMain);
  document.getElementById('install-gate-skip-btn').addEventListener('click', () => {
    localStorage.setItem(INSTALL_GATE_SKIP_KEY, '1');
    closeInstallGate();
  });
}

function renderInstallGateInstalled() {
  const offerNotify = notifyPushSupported() && Notification.permission === 'default';
  setInstallGateSheet(
    '<p class="install-gate-desc">Готово! Застосунок встановлено. Закрийте цю вкладку браузера і відкрийте Sun-ice з ярлика на головному екрані.</p>' +
    (offerNotify
      ? '<p class="install-gate-desc">Останній крок — увімкніть сповіщення, щоб не пропустити акції та статус заявки:</p>' +
        '<button type="button" class="install-gate-install-btn" id="install-gate-notify-btn">Дозволити сповіщення</button>'
      : '')
  );
  const notifyBtn = document.getElementById('install-gate-notify-btn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', async () => {
      notifyBtn.disabled = true;
      await Notification.requestPermission();
      await autoAttachPushIfGranted();
      updateNotifyBanner();
      if (Notification.permission === 'granted') {
        notifyBtn.textContent = 'Дозволено ✓';
      } else {
        notifyBtn.textContent = 'Дозволити сповіщення';
        notifyBtn.disabled = false;
      }
    });
  }
}

function renderInstallGateManualFallback() {
  setInstallGateSheet(
    installGateHeaderHtml() +
    '<p class="install-gate-desc">Браузер поки не готовий запропонувати швидке встановлення. Відкрийте меню браузера (⋮) і оберіть «Додати на головний екран» / «Встановити застосунок».</p>' +
    '<button type="button" class="install-gate-later-btn" id="install-gate-later-btn">Не зараз</button>'
  );
  document.getElementById('install-gate-later-btn').addEventListener('click', renderInstallGateConfirmSkip);
}

function renderInstallGateIOS() {
  setInstallGateSheet(
    installGateHeaderHtml() +
    '<p class="install-gate-desc">Щоб встановити застосунок на iPhone/iPad: натисніть кнопку «Поділитися» ⬆ внизу екрана Safari, потім оберіть «На екран Домой».</p>' +
    '<button type="button" class="install-gate-later-btn" id="install-gate-later-btn">Не зараз</button>'
  );
  document.getElementById('install-gate-later-btn').addEventListener('click', renderInstallGateConfirmSkip);
}

function renderInstallGateInApp(name) {
  setInstallGateSheet(
    installGateHeaderHtml() +
    '<p class="install-gate-desc">Це посилання відкрито у вбудованому браузері ' + escapeHtml(name) + ' — з нього застосунок не встановлюється. Натисніть «⋮» (або «...») у верхньому куті екрана і оберіть «Відкрити в браузері» (Chrome/Safari), а вже там встановіть застосунок.</p>' +
    '<button type="button" class="install-gate-later-btn" id="install-gate-later-btn">Не зараз</button>'
  );
  document.getElementById('install-gate-later-btn').addEventListener('click', renderInstallGateConfirmSkip);
}

function renderInstallGateMain() {
  const inApp = detectInAppBrowserName();
  if (inApp) { renderInstallGateInApp(inApp); return; }
  if (isIOS) { renderInstallGateIOS(); return; }

  setInstallGateSheet(
    installGateHeaderHtml() +
    '<p class="install-gate-desc">Встановіть застосунок на головний екран телефону — швидкий запуск без браузера та push-сповіщення про нові акції і статус заявки.</p>' +
    '<button type="button" class="install-gate-install-btn" id="install-gate-install-btn">Встановити</button>' +
    '<button type="button" class="install-gate-later-btn" id="install-gate-later-btn">Не зараз</button>'
  );
  document.getElementById('install-gate-install-btn').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') renderInstallGateInstalled();
    } else {
      renderInstallGateManualFallback();
    }
  });
  document.getElementById('install-gate-later-btn').addEventListener('click', renderInstallGateConfirmSkip);
}

function showInstallGate() {
  if (isStandalone) return;
  if (localStorage.getItem(INSTALL_GATE_SKIP_KEY) === '1') return;
  renderInstallGateMain();
  document.getElementById('install-gate').classList.add('show');
}


/* ---------- Банер "увімкніть сповіщення" ---------- */
/* Хрестик не вимикає нагадування назавжди (сповіщення про акції й статус заявки —
   не дрібниця) — лише відкладає банер на кілька днів, за аналогією з нагадуванням
   про акції (PROMO_BALLOON_INTERVAL_MS вище). Якщо дозвіл надано в налаштуваннях
   назавжди відхилено (Notification.permission === 'denied'), банер не показуємо
   взагалі — повторний запит браузер однаково заблокує, а поради "змініть у
   налаштуваннях браузера" в тонкому банері лише дратуватимуть. */
const NOTIFY_BANNER_SNOOZE_KEY = 'sunice_notify_banner_snooze_until';
const NOTIFY_BANNER_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function updateNotifyBanner() {
  const banner = document.getElementById('notify-banner');
  if (!banner) return;
  if (!notifyPushSupported() || Notification.permission !== 'default') {
    banner.classList.remove('show');
    return;
  }
  const snoozeUntil = Number(localStorage.getItem(NOTIFY_BANNER_SNOOZE_KEY) || 0);
  banner.classList.toggle('show', Date.now() >= snoozeUntil);
}

async function handleNotifyBannerEnable() {
  const btn = document.getElementById('notify-banner-btn');
  btn.disabled = true;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData ? sessionData.session : null;
    if (session) {
      await enablePushNotifications(session.user.id);
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Дозвіл на сповіщення не надано. Увімкнути його можна пізніше в налаштуваннях браузера.');
      }
    }
  } catch (e) {
    alert('Не вдалося увімкнути сповіщення на цьому пристрої.');
  }
  btn.disabled = false;
  updateNotifyBanner();
}


/* ---------- Перегляд зображення на весь екран: наближення/віддалення, панорамування ---------- */

/* ---------- Service worker (push-сповіщення + бейдж на іконці) ---------- */

/* ---------- Старт ----------
   Правило (2026-10-06, узгоджено з власником):
   • є збережена сесія (зареєстрований/увійшов) → ЗАВЖДИ каталог, хеш в адресі ігнорується;
   • сесії немає → відкриваємо «Кабінет» одразу з формою: «Реєстрація» для пристрою, де акаунта ще не
     було, і «Вхід» для пристрою, де вже входили (сесія злетіла/вихід) — щоб людина не реєструвалась
     вдруге. Форма показується на КОЖНОМУ запуску, доки немає входу; нижнє меню не блокується —
     пропустити можна одним дотиком по «Каталог».
   Наявність сесії визначаємо синхронно за ключем Supabase у localStorage (sb-…-auth-token), щоб
   не блимати каталогом, поки getSession() відповідає. Прострочений токен тут нічого не ламає:
   каталог відкриється, а ensureAccessFresh() сам перевірить доступ. */
const DEVICE_HAD_ACCOUNT_KEY = 'sunice_had_session';
function markDeviceHadAccount() {
  try { localStorage.setItem(DEVICE_HAD_ACCOUNT_KEY, '1'); } catch (e) {}
}
function deviceHasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch (e) {}
  return false;
}
