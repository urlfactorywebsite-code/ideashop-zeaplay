const ACCOUNT_CACHE = 'zea-push-account-v1';
const ACCOUNT_KEY = new URL('/__zea_push_account__', self.location.origin).href;
let pendingOperation = Promise.resolve();

// Binding changes and delivery share a queue: logout either prevents display or
// closes a notification displayed just before the account was cleared.
const serialize = (operation) => {
  const result = pendingOperation.then(operation);
  pendingOperation = result.catch(() => undefined);
  return result;
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const safeUrl = (value, fallback = null) => {
  if (!nonEmptyString(value)) return fallback;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || !['https:', 'http:'].includes(url.protocol)) return fallback;
    if (url.username || url.password) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
};

const normalizeAccount = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const userId = nonEmptyString(value.userId);
  const tenantId = nonEmptyString(value.tenantId);
  return userId && tenantId ? { userId, tenantId } : null;
};

const sameAccount = (left, right) =>
  Boolean(left && right && left.userId === right.userId && left.tenantId === right.tenantId);

const readAccount = async () => {
  const cache = await self.caches.open(ACCOUNT_CACHE);
  const response = await cache.match(ACCOUNT_KEY);
  return response ? normalizeAccount(await response.json()) : null;
};

const payloadAccount = (payload) => normalizeAccount({
  userId: payload.recipient_user_id,
  tenantId: payload.recipient_tenant_id,
});

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ZEA_PUSH_ACCOUNT') return;
  const port = event.ports?.[0];
  event.waitUntil(serialize(async () => {
    const client = event.source?.id ? await self.clients.get(event.source.id) : null;
    if (!client || client.type !== 'window' || !safeUrl(client.url)) {
      throw new Error('Push account binding requires an app window.');
    }
    const account = normalizeAccount(event.data.account);
    if (event.data.account !== null && !account) {
      throw new Error('Invalid push account binding.');
    }
    const previous = await readAccount();
    const cache = await self.caches.open(ACCOUNT_CACHE);
    await cache.put(ACCOUNT_KEY, new Response(JSON.stringify(account), {
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!sameAccount(previous, account)) {
      const notifications = await self.registration.getNotifications();
      notifications.forEach((notification) => notification.close());
    }
    port?.postMessage({ type: 'ZEA_PUSH_ACCOUNT_ACK', ok: true });
  }).catch(() => {
    port?.postMessage({
      type: 'ZEA_PUSH_ACCOUNT_ACK',
      ok: false,
      error: 'Unable to update push account binding.',
    });
  }));
});

self.addEventListener('push', (event) => {
  event.waitUntil(serialize(async () => {
    let payload;
    try {
      payload = event.data?.json();
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    // Older/queued messages without the current authenticated recipient are
    // deliberately ignored, including after a logout or account/tenant switch.
    const account = payloadAccount(payload);
    if (!sameAccount(await readAccount(), account)) return;
    const notificationId = nonEmptyString(payload.notification_id);
    const title = nonEmptyString(payload.title) || 'ZeaPlay';
    const options = {
      body: nonEmptyString(payload.body) || 'You have a new notification.',
      data: {
        url: safeUrl(payload.url, `${self.location.origin}/`),
        notificationId,
        eventType: nonEmptyString(payload.event_type),
        module: nonEmptyString(payload.module),
        recipient_user_id: account.userId,
        recipient_tenant_id: account.tenantId,
      },
    };
    const icon = safeUrl(payload.icon);
    const badge = safeUrl(payload.badge);
    if (icon) options.icon = icon;
    if (badge) options.badge = badge;
    if (notificationId) options.tag = `zea-notification-${notificationId}`;
    await self.registration.showNotification(title, options);
  }).catch((error) => {
    console.error('Unable to display push notification', error);
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(serialize(async () => {
    const data = event.notification.data || {};
    if (!sameAccount(await readAccount(), payloadAccount(data))) return;
    const targetUrl = safeUrl(data.url, `${self.location.origin}/`);
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .filter((client) => safeUrl(client.url) && typeof client.focus === 'function')
      .sort((left, right) => Number(right.url === targetUrl) - Number(left.url === targetUrl));
    for (const client of clients) {
      try {
        if (client.url !== targetUrl) {
          if (typeof client.navigate !== 'function') continue;
          const navigated = await client.navigate(targetUrl);
          if (!navigated) continue;
        }
        await client.focus();
        return;
      } catch {
        // A tab can close while its notification is being opened; try another.
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  }).catch((error) => {
    console.error('Unable to open push notification', error);
  }));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Only an authenticated page can reconcile the replacement with the API.
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        if (safeUrl(client.url)) client.postMessage({ type: 'ZEA_PUSH_SUBSCRIPTION_CHANGED' });
      }
    }));
});
