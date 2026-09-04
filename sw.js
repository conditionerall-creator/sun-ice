/* Sun-ice — service worker: push-сповіщення + лічильник (бейдж) на іконці застосунку */
const APP_NAME = 'Sun-ice';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
