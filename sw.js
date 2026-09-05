/* Sun-ice — service worker: push-сповіщення + лічильник (бейдж) на іконці застосунку
   + офлайн-кешування самого застосунку (App Shell), щоб він відкривався швидко і
   працював без інтернету. Дані з Supabase (прайс, авторизація, акції тощо) сюди НЕ
   потрапляють — вони завжди йдуть напряму в мережу, кеш їх не чіпає. */
const APP_NAME = 'Sun-ice';

/* Підвищуй цю версію, коли треба примусово скинути закешовану статику користувачам
   (наприклад, якщо після оновлення щось виглядає "старим") — старий кеш видаляється
   автоматично в 'activate'. */
const CACHE_VERSION = 'v1';
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
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
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

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: APP_NAME, body: event.data ? event.data.text() : '' };
  }

  const title = data.title || APP_NAME;
  const options = {
    body: data.body || '',
    tag: data.tag || 'sunice-notification',
    renotify: true,
    data: { url: data.url || '/' }
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(updateBadge)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
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
