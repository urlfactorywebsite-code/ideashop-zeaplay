import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.example.com';
const ACCOUNT = { userId: 'user-a', tenantId: 'tenant-a' };
const PAYLOAD = {
  title: 'Task assigned',
  body: 'Review the task',
  url: '/#/tasks?taskId=task-a',
  notification_id: 'notification-a',
  event_type: 'TASK_ASSIGNED',
  module: 'tasks',
  recipient_user_id: ACCOUNT.userId,
  recipient_tenant_id: ACCOUNT.tenantId,
};

const harness = ({ cacheEntries = new Map(), windows = [], showNotification, openWindow } = {}) => {
  const listeners = new Map();
  const shown = [];
  const opened = [];
  const logs = [];
  const notices = [];
  const sourceClient = { id: 'app-tab', type: 'window', url: `${ORIGIN}/#/settings` };
  const cache = {
    match: async (key) => cacheEntries.has(key) ? new Response(cacheEntries.get(key)) : undefined,
    put: async (key, response) => cacheEntries.set(key, await response.text()),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    caches: { open: async () => cache },
    clients: {
      claim: async () => undefined,
      get: async (id) => id === sourceClient.id ? sourceClient : null,
      matchAll: async () => windows,
      openWindow: openWindow || (async (url) => { opened.push(url); }),
    },
    registration: {
      showNotification: showNotification || (async (title, options) => { shown.push({ title, options }); }),
      getNotifications: async () => notices,
    },
  };
  vm.runInNewContext(swSource, {
    self, URL, Response, console: { error: (...args) => logs.push(args) },
  });
  const emit = async (type, extra = {}) => {
    const pending = [];
    listeners.get(type)({ ...extra, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };
  const bind = async (account = ACCOUNT, extra = {}) => {
    const replies = [];
    await emit('message', {
      data: { type: 'ZEA_PUSH_ACCOUNT', account },
      source: { id: sourceClient.id },
      ports: [{ postMessage: (reply) => replies.push(reply) }],
      ...extra,
    });
    return replies;
  };
  const push = (payload = PAYLOAD) => emit('push', { data: { json: () => payload } });
  const click = async (data = PAYLOAD) => {
    let closed = false;
    await emit('notificationclick', { notification: { data, close: () => { closed = true; } } });
    assert.equal(closed, true);
  };
  return { self, emit, bind, push, click, shown, opened, logs, notices, cacheEntries, sourceClient };
};

test('valid recipient push displays content, a stable tag and same-origin hash deep link', async () => {
  const worker = harness();
  assert.equal((await worker.bind())[0].ok, true);
  await worker.push();
  const { title, options } = worker.shown[0];
  assert.equal(title, PAYLOAD.title);
  assert.equal(options.body, PAYLOAD.body);
  assert.equal(options.data.url, `${ORIGIN}/#/tasks?taskId=task-a`);
  assert.equal(options.tag, 'zea-notification-notification-a');
  assert.equal(options.icon, undefined);
  assert.equal(options.badge, undefined);
  await worker.push();
  assert.equal(worker.shown[1].options.tag, options.tag);
});

test('missing, malformed, primitive and unscoped payloads do not display or throw', async () => {
  const worker = harness();
  await worker.bind();
  await worker.emit('push');
  await worker.emit('push', { data: { json: () => { throw new Error('bad JSON'); } } });
  for (const payload of [null, [], 4, 'text', {}, { title: 'Legacy private content' }]) {
    await worker.push(payload);
  }
  assert.equal(worker.shown.length, 0);
  assert.equal(worker.logs.length, 0);
});

test('invalid content types use generic text and reject external, credential and non-HTTP assets', async () => {
  const worker = harness();
  await worker.bind();
  await worker.push({
    ...PAYLOAD, title: { private: true }, body: [], icon: 'https://tracking.example/icon',
    badge: 'data:image/png;base64,abc', url: 'javascript:alert(1)',
  });
  assert.equal(worker.shown[0].title, 'ZeaPlay');
  assert.equal(worker.shown[0].options.body, 'You have a new notification.');
  assert.equal(worker.shown[0].options.data.url, `${ORIGIN}/`);
  assert.equal(worker.shown[0].options.icon, undefined);
  assert.equal(worker.shown[0].options.badge, undefined);
  await worker.push({ ...PAYLOAD, icon: '/icon.png', badge: '/badge.png' });
  assert.equal(worker.shown[1].options.icon, `${ORIGIN}/icon.png`);
  assert.equal(worker.shown[1].options.badge, `${ORIGIN}/badge.png`);
  await worker.push({ ...PAYLOAD, icon: 'https://name:secret@app.example.com/icon.png' });
  assert.equal(worker.shown[2].options.icon, undefined);
});

test('binding persists across service-worker restarts and suppresses account or tenant mismatches', async () => {
  const first = harness();
  await first.push();
  assert.equal(first.shown.length, 0);
  await first.bind();
  const restarted = harness({ cacheEntries: first.cacheEntries });
  await restarted.push({ ...PAYLOAD, recipient_user_id: 'user-b' });
  await restarted.push({ ...PAYLOAD, recipient_tenant_id: 'tenant-b' });
  await restarted.push();
  assert.equal(restarted.shown.length, 1);
});

test('logout and account switches clear displayed notifications and block queued old-account pushes/clicks', async () => {
  const worker = harness();
  await worker.bind();
  let closed = 0;
  worker.notices.push({ close: () => { closed += 1; } });
  await worker.bind(ACCOUNT);
  assert.equal(closed, 0);
  await worker.bind({ userId: 'user-b', tenantId: 'tenant-a' });
  assert.equal(closed, 1);
  await worker.push();
  await worker.click();
  assert.equal(worker.shown.length, 0);
  assert.equal(worker.opened.length, 0);
  await worker.bind(null);
  assert.equal(closed, 2);
  await worker.push({ ...PAYLOAD, recipient_user_id: 'user-b' });
  assert.equal(worker.shown.length, 0);
});

test('account messages reject missing, non-window and foreign-origin clients', async () => {
  const worker = harness();
  const missing = await worker.bind(ACCOUNT, { source: { id: 'unknown' } });
  assert.equal(missing[0].ok, false);
  worker.sourceClient.type = 'worker';
  assert.equal((await worker.bind())[0].ok, false);
  worker.sourceClient.type = 'window';
  worker.sourceClient.url = 'https://untrusted.example/';
  assert.equal((await worker.bind())[0].ok, false);
  worker.sourceClient.url = `${ORIGIN}/`;
  assert.equal((await worker.bind({ userId: ACCOUNT.userId }))[0].ok, false);
  await worker.push();
  assert.equal(worker.shown.length, 0);
});

test('account persistence failures return an error ACK and fail closed for delivery', async () => {
  const worker = harness();
  worker.self.caches.open = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await worker.bind())[0].ok, false);
  await worker.push();
  assert.equal(worker.shown.length, 0);
  assert.equal(worker.logs.length, 1);
});

test('logout queued during notification display waits then closes the notification', async () => {
  let finishDisplay;
  const worker = harness({
    showNotification: () => new Promise((resolve) => { finishDisplay = resolve; }),
  });
  await worker.bind();
  let closed = 0;
  worker.notices.push({ close: () => { closed += 1; } });
  const delivery = worker.push();
  while (!finishDisplay) await new Promise((resolve) => setImmediate(resolve));
  const logout = worker.bind(null);
  finishDisplay();
  await Promise.all([delivery, logout]);
  assert.equal(closed, 1);
  await worker.click();
  assert.equal(worker.opened.length, 0);
});

test('notification display failures are caught and logged without poisoning later delivery', async () => {
  let calls = 0;
  const worker = harness({
    showNotification: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Permission denied');
    },
  });
  await worker.bind();
  await worker.push();
  await worker.push();
  assert.equal(calls, 2);
  assert.equal(worker.logs[0][0], 'Unable to display push notification');
});

test('click focuses an exact existing target before considering other app windows', async () => {
  const actions = [];
  const worker = harness({ windows: [
    { url: `${ORIGIN}/#/settings`, navigate: async () => { actions.push('wrong navigation'); }, focus: async () => {} },
    { url: `${ORIGIN}${PAYLOAD.url}`, focus: async () => { actions.push('target focused'); } },
  ] });
  await worker.bind();
  await worker.click();
  assert.deepEqual(actions, ['target focused']);
  assert.equal(worker.opened.length, 0);
});

test('click waits for navigation before focus and falls back when tabs disappear', async () => {
  const actions = [];
  const worker = harness({ windows: [
    { url: `${ORIGIN}/#/old`, navigate: async () => { throw new Error('closed'); }, focus: async () => {} },
    { url: `${ORIGIN}/#/other`, navigate: async (url) => {
      await new Promise((resolve) => setImmediate(resolve));
      actions.push(`navigated:${url}`);
      return {};
    }, focus: async () => { actions.push('focused'); } },
  ] });
  await worker.bind();
  await worker.click();
  assert.deepEqual(actions, [`navigated:${ORIGIN}${PAYLOAD.url}`, 'focused']);
  assert.equal(worker.opened.length, 0);
});

test('click opens safe fallback when every app window navigation fails', async () => {
  const worker = harness({ windows: [
    { url: 'https://external.example/', focus: async () => { assert.fail('foreign window focused'); } },
    { url: `${ORIGIN}/#/old`, navigate: async () => null, focus: async () => { assert.fail('closed window focused'); } },
  ] });
  await worker.bind();
  for (const url of ['https://external.example/phish', '//external.example/phish', 'javascript:alert(1)', 'http://[bad']) {
    await worker.click({ ...PAYLOAD, url });
  }
  assert.deepEqual(worker.opened, Array(4).fill(`${ORIGIN}/`));
});

test('click handles openWindow rejection without unhandled errors', async () => {
  const worker = harness({ openWindow: async () => { throw new Error('Window blocked'); } });
  await worker.bind();
  await worker.click();
  assert.equal(worker.logs[0][0], 'Unable to open push notification');
});

test('pushsubscriptionchange asks existing app windows to reconcile authenticated subscriptions', async () => {
  const messages = [];
  const worker = harness({ windows: [{
    url: `${ORIGIN}/#/settings`,
    postMessage: (message) => messages.push(message),
  }, {
    url: 'https://external.example/',
    postMessage: () => assert.fail('foreign window received message'),
  }] });
  await worker.emit('pushsubscriptionchange');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'ZEA_PUSH_SUBSCRIPTION_CHANGED');
});
