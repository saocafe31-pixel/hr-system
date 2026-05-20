self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  const title = payload.title || 'FOLIAGE';
  const body = payload.body || 'มีการแจ้งเตือนใหม่';
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      tag: data.channel || 'foliage-notification',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    })
  );
});
