self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'ZeaPlay';
  const options = {
    body: payload.body || 'You have a new notification.',
    data: {
      url: payload.url || '/',
      notificationId: payload.notification_id || null,
      eventType: payload.event_type || null,
      module: payload.module || null,
    },
  };

  if (typeof payload.icon === 'string' && payload.icon.trim()) {
    options.icon = payload.icon;
  }

  if (typeof payload.badge === 'string' && payload.badge.trim()) {
    options.badge = payload.badge;
  }

  event.waitUntil(
    self.registration.showNotification(title, options).catch((error) => {
      console.error('Unable to display push notification', error);
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
