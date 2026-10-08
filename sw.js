/* Sun-ice — service worker: push-сповіщення + лічильник (бейдж) на іконці застосунку
   + офлайн-кешування самого застосунку (App Shell), щоб він відкривався швидко і
   працював без інтернету. Дані з Supabase (прайс, авторизація, акції тощо) сюди НЕ
   потрапляють — вони завжди йдуть напряму в мережу, кеш їх не чіпає. */
const APP_NAME = 'Sun-ice';

/* Підвищуй цю версію, коли треба примусово скинути закешовану статику користувачам
   (наприклад, якщо після оновлення щось виглядає "старим") — старий кеш видаляється
   автоматично в 'activate'. */
const CACHE_VERSION = 'v4';
const CACHE_NAME = 'sunice-shell-' + CACHE_VERSION;

/* "Оболонка" застосунку — те, що потрібне, щоб сторінка відкрилась і показала хоч
   щось навіть офлайн. Кешуємо кожен файл окремо (не через addAll), щоб один
   відсутній файл (напр. manifest.json, якщо його нема в цьому репозиторії) не зривав
   кешування решти. */
const APP_SHELL = [
  self.registration.scope,
  new URL('index.html', self.registration.scope).href,
  new URL('manifest.json', self.registration.scope).href,
  new URL('icon-192.png', self.registration.scope).href,
  new URL('apple-touch-icon.png', self.registration.scope).href,
  /* Код застосунку. З 2026-10-08 він живе в js/*.js, а не всередині index.html.
     ?v= мусить збігатися з APP_BUILD і з тегами <script> в index.html ТОЧНО —
     піднімати все разом однією командою:
         python claude/split-index/set-build.py РРРР-ММ-ДД.N
     Якщо розійдеться, сюди ляже один файл, а сторінка попросить інший, і офлайн
     застосунок не підніметься. Перевірка «Модулі застосунку» в самодіагностиці
     стежить за цим збігом. */
  ...[
    'js/01-config.js?v=2026-10-08.6',
    'js/02-price-parse.js?v=2026-10-08.6',
    'js/03-diagnostics.js?v=2026-10-08.6',
    'js/04-catalog.js?v=2026-10-08.6',
    'js/05-catalog-custom.js?v=2026-10-08.6',
    'js/06-cart-promo.js?v=2026-10-08.6',
    'js/07-access-info.js?v=2026-10-08.6',
    'js/08-info-tables.js?v=2026-10-08.6',
    'js/09-cabinet.js?v=2026-10-08.6',
    'js/10-crmontage.js?v=2026-10-08.6',
    'js/11-shell.js?v=2026-10-08.6',
    'js/12-start.js?v=2026-10-08.6'
  ].map((p) => new URL(p, self.registration.scope).href),
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  /* Адреса ТОЧНО така сама, як у <script> в index.html (версія зафіксована 2026-09-21).
     Якщо розійдеться — сюди кешуватиметься один файл, а сторінка проситиме інший,
     і офлайн застосунок не підніметься. Міняти обидва місця разом. */
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

/* ВАЖЛИВО: не cache.add(), а fetch з { cache: 'reload' }.
   cache.add() бере копію зі ЗВИЧАЙНОГО HTTP-кеша браузера — тобто в офлайн-копію
   могла лягти стара сторінка. Разом із прибиранням застарілих модулів (нижче) це
   давало найгірший можливий збіг: закешований index.html просить версії js/*.js,
   яких у кеші вже немає, і БЕЗ ІНТЕРНЕТУ ЗАСТОСУНОК НЕ ПІДНІМАЄТЬСЯ.
   Напоролись на це 2026-10-08 під час перевірки офлайну — не повертати cache.add(). */
function cacheFresh(cache, url) {
  return fetch(url, { cache: 'reload' })
    .then((res) => (res && res.ok ? cache.put(url, res) : null))
    .catch(() => {});
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cacheFresh(cache, url)))
    )
  );
});

/* Прибирання застарілих модулів коду.
   Кожна заливка міняє ?v= у js/*.js — тобто це НОВІ адреси, а старі лишались би в
   тому самому кеші назавжди (видаляється лише кеш з іншим CACHE_VERSION). За рік
   таких заливок на телефоні осіло б кілька мегабайт коду, який уже ніхто не попросить.
   Тому при активації викидаємо з кеша все, що лежить у js/ і чого немає в APP_SHELL.
   Решти (зображення, іконки, бібліотеки) це не чіпає. */
function pruneStaleModules(cache) {
  const keep = APP_SHELL.filter((u) => u.indexOf('/js/') >= 0);
  return cache.keys().then((reqs) =>
    Promise.all(
      reqs
        .filter((r) => r.url.indexOf('/js/') >= 0 && keep.indexOf(r.url) < 0)
        .map((r) => cache.delete(r))
    )
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
      caches.open(CACHE_NAME).then(pruneStaleModules)
    ])
  );
});

/* Стратегія кешування для звичайних GET-запитів (не Supabase):
   - HTML-сторінка застосунку: спершу мережа (щоб одразу підхопити новий деплой на
     GitHub Pages), а якщо офлайн/немає зв'язку — віддаємо останню закешовану версію.
   - Все інше статичне (свій CSS/JS, шрифти, supabase-js, xlsx.js з CDN): спершу кеш
     (миттєве відкриття), паралельно у фоні тихо оновлюємо кеш свіжою версією. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co')) return; // прайс, авторизація, акції — завжди напряму в мережу

  const isHtmlNavigation = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHtmlNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match(new URL('index.html', self.registration.scope).href))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

/* Куди вести по тапу на сповіщення. Сервер шле url: "/" — на GitHub Pages це корінь
   домену, а не застосунок (він у /sun-ice/). Тому "/" і порожнє значення замінюємо на
   власну адресу застосунку; будь-яку іншу адресу з сервера поважаємо як є, але
   приводимо до абсолютної відносно scope. */
function notificationTargetUrl(raw) {
  const scope = self.registration.scope;
  const s = raw && String(raw).trim();
  if (!s || s === '/') return scope;
  try { return new URL(s, scope).href; } catch (e) { return scope; }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: APP_NAME, body: event.data ? event.data.text() : '' };
  }

  const title = data.title || APP_NAME;
  /* ТРИ ВИПРАВЛЕННЯ 2026-09-21:

     1) icon/badge. Без них Android малює в шторці сіру системну заглушку замість
        логотипа Sun-ice — сповіщення не впізнаване з першого погляду.

     2) МІТКА (tag). Була однакова для всіх сповіщень ('sunice-notification'), а за
        правилами Web Push нове сповіщення з тією самою міткою ЗАМІНЮЄ попереднє. Тобто
        дві акції підряд (або акція + заявка на реєстрацію) давали одне сповіщення:
        друге тихо витісняло перше. Тепер мітка від сервера зберігається (там вони вже
        різні: 'sunice-promo' для акцій), а коли її немає — робимо унікальну.
        renotify має сенс лише разом з тим самим tag, тому вмикаємо його тільки тоді,
        коли мітку явно задав сервер, — інакше браузер лається на renotify без tag.

     3) url за замовчуванням. Було '/', а застосунок живе за адресою /sun-ice/ на
        GitHub Pages: тап по сповіщенню при повністю закритому застосунку відкривав
        корінь домену, тобто порожню сторінку. Тепер за замовчуванням — власна адреса
        застосунку (scope). Те саме робимо і з '/', який шле Edge Function
        send-promo-push: перевіряти там нічого не треба, лагодимо на своєму боці.

     ВАЖЛИВО: браузер бере ці налаштування зі СВІЖОГО sw.js. Тому CACHE_VERSION
     піднято до v3 — щоб старий service worker гарантовано замінився. */
  const serverTag = data.tag && String(data.tag).trim();
  const options = {
    body: data.body || '',
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,
    tag: serverTag || ('sunice-' + Date.now()),
    renotify: !!serverTag,
    data: { url: notificationTargetUrl(data.url) }
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(updateBadge)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = notificationTargetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }).then(updateBadge)
  );
});

/* Основна сторінка може попросити SW прибрати бейдж і закрити сповіщення
   (наприклад, коли адміністратор відкрив розділ "Кабінет" і побачив заявки) */
self.addEventListener('message', (event) => {
  if (event.data === 'clear-notifications') {
    event.waitUntil(
      self.registration.getNotifications().then((list) => {
        list.forEach((n) => n.close());
        return updateBadge();
      })
    );
  }
});

function updateBadge() {
  if (!self.navigator || !('setAppBadge' in self.navigator)) return Promise.resolve();
  return self.registration.getNotifications().then((list) => {
    if (list.length > 0) return self.navigator.setAppBadge(list.length);
    return self.navigator.clearAppBadge ? self.navigator.clearAppBadge() : Promise.resolve();
  });
}
