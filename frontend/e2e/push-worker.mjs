// Exercise the actual service worker in Chrome. Push arrives via DevTools;
// no browser push provider, real user, application API or database is contacted.
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.ZEAPLAY_PUSH_TEST_URL || 'http://127.0.0.1:6302';
const origin = new URL(base).origin;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const output = new URL(process.env.ZEAPLAY_PUSH_OUTPUT || '../../docs/push-notifications/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const scratchRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(scratchRoot, 'zea-push-worker-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: true, permissions: ['notifications'], serviceWorkers: 'allow',
});
const page = await context.newPage();
const errors = [];
const workerErrors = [];
const results = [];
const registrations = new Map();
const cdp = await context.newCDPSession(page);
cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updates }) => {
  for (const registration of updates) registrations.set(registration.registrationId, registration);
});
page.on('pageerror', (error) => errors.push(error.message));
context.on('console', (message) => {
  if (message.type() === 'error' && message.text().includes('push notification')) workerErrors.push(message.text());
});
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/__push-worker-test') {
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Push worker audit</title><p>Synthetic local push verification</p>' });
  }
  if (url.pathname !== '/sw.js') return route.abort();
  return route.continue();
});

const account = { userId: 'synthetic-user-a', tenantId: 'synthetic-tenant-a' };
const payload = {
  title: 'Synthetic ZeaPlay push test',
  body: 'Local browser worker verification only',
  url: '/#/tasks?taskId=synthetic-task',
  notification_id: 'synthetic-notification',
  recipient_user_id: account.userId,
  recipient_tenant_id: account.tenantId,
};
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
};
const notifications = () => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  return (await registration.getNotifications()).map((notification) => ({
    title: notification.title, body: notification.body, data: notification.data, tag: notification.tag,
  }));
});
const bind = (value) => page.evaluate(async (accountValue) => {
  const registration = await navigator.serviceWorker.ready;
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('Push binding acknowledgement timed out')), 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    registration.active.postMessage({ type: 'ZEA_PUSH_ACCOUNT', account: accountValue }, [channel.port2]);
  });
}, value);
const installObserver = async (worker) => {
  await worker.evaluate(() => {
    self.__notificationAttempts = [];
    // Observe the native call without replacing its result or display behavior.
    const show = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = async function (...args) {
      const attempt = { title: args[0], options: args[1], outcome: 'pending' };
      self.__notificationAttempts.push(attempt);
      try {
        const value = await show.apply(this, args);
        attempt.outcome = 'resolved';
        return value;
      } catch (error) {
        attempt.outcome = 'rejected';
        attempt.error = error.message;
        throw error;
      }
    };
    self.addEventListener('push', (event) => {
      // The production listener runs first and sets its serialized operation.
      event.waitUntil(pendingOperation.then(async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const windowClient of windows) windowClient.postMessage({ type: 'ZEA_TEST_PUSH_PROCESSED' });
      }));
    });
  });
};
let registrationId;
const deliver = async (value) => {
  const before = await page.evaluate(() => window.processedPushes);
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin, registrationId, data: typeof value === 'string' ? value : JSON.stringify(value),
  });
  await page.waitForFunction((previous) => window.processedPushes > previous, before);
};

try {
  await cdp.send('ServiceWorker.enable');
  await page.goto(`${origin}/__push-worker-test`);
  await page.evaluate(() => {
    window.processedPushes = 0;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'ZEA_TEST_PUSH_PROCESSED') window.processedPushes += 1;
    });
  });
  const workerPromise = context.waitForEvent('serviceworker');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  const worker = await workerPromise;
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  registrationId = await waitFor(
    () => [...registrations.values()].find((registration) => registration.scopeURL === `${origin}/` && !registration.isDeleted)?.registrationId,
    'active worker registration',
  );
  await installObserver(worker);
  const attempts = () => worker.evaluate(() => self.__notificationAttempts);
  assert.equal((await bind(account)).ok, true);
  results.push('Actual /sw.js activates in Chrome and acknowledges a real MessageChannel account binding');

  await deliver(payload);
  const shown = (await attempts())[0];
  assert.equal(shown.outcome, 'resolved');
  assert.equal(shown.title, payload.title);
  assert.equal(shown.options.body, payload.body);
  assert.equal(shown.options.data.url, `${origin}${payload.url}`);
  assert.equal(shown.options.data.recipient_user_id, account.userId);
  const displayed = await notifications();
  const registryAvailable = displayed.length > 0;
  if (registryAvailable) assert.equal(displayed[0].title, payload.title);
  results.push('DevTools delivers to the actual worker; native showNotification resolves with expected content and routing');

  await deliver(payload);
  assert.equal((await attempts())[1].options.tag, shown.options.tag);
  if (registryAvailable) assert.equal((await notifications()).length, 1);
  results.push('Repeated notification ID passes the same replacement tag to native showNotification');
  await deliver({ ...payload, notification_id: 'wrong-user', recipient_user_id: 'synthetic-other-user' });
  await deliver({ ...payload, notification_id: 'wrong-tenant', recipient_tenant_id: 'synthetic-other-tenant' });
  await deliver({ title: 'Legacy unscoped private content' });
  await deliver('not-json');
  await deliver(null);
  assert.equal((await attempts()).length, 2);
  if (registryAvailable) assert.equal((await notifications()).length, 1);
  results.push('Wrong account/tenant, unscoped and malformed messages are suppressed by the actual worker');

  assert.equal((await bind(null)).ok, true);
  assert.equal((await notifications()).length, 0);
  await deliver(payload);
  assert.equal((await attempts()).length, 2);
  assert.equal(await worker.evaluate(() => readAccount()), null);
  results.push('Clearing the persisted account suppresses queued old-account delivery');

  assert.equal((await bind(account)).ok, true);
  await deliver({ ...payload, url: 'https://external.example/phishing', icon: 'https://external.example/tracker.png' });
  assert.equal((await attempts())[2].options.data.url, `${origin}/`);
  assert.equal((await attempts())[2].options.icon, undefined);
  results.push('Unsafe external notification target is replaced with the same-origin application root');

  const nextAccount = { userId: 'synthetic-user-b', tenantId: 'synthetic-tenant-b' };
  assert.equal((await bind(nextAccount)).ok, true);
  assert.equal((await notifications()).length, 0);
  await deliver(payload);
  assert.equal((await attempts()).length, 3);
  const replacement = { ...payload, recipient_user_id: nextAccount.userId, recipient_tenant_id: nextAccount.tenantId };
  await deliver(replacement);
  assert.equal((await attempts()).length, 4);
  assert.equal((await attempts())[3].outcome, 'resolved');
  results.push('Account switch permits native showNotification only for the new recipient');

  assert.equal(errors.length, 0, errors.join('\n'));
  const report = {
    passed: true,
    scenario_count: results.length,
    scenarios: results,
    page_errors: errors,
    worker_errors: workerErrors,
    delivery: 'Chrome DevTools ServiceWorker.deliverPushMessage -> actual /sw.js -> native showNotification',
    native_show_notification_calls: await attempts(),
    browser_notification_registry_available: registryAvailable,
    browser_notification_registry_count_after_first_delivery: displayed.length,
    limitations: [
      'Synthetic DevTools delivery bypasses Web Push provider, encryption and VAPID.',
      ...(!registryAvailable ? ['This Windows headless Chrome returned no getNotifications records after native showNotification resolved; visual replacement and closing are covered by VM tests only.'] : []),
      'Headless native API success does not prove a visible OS notification or sound.',
      'Trusted user notification clicks are covered by VM handler tests, not an OS click in this harness.',
    ],
  };
  await writeFile(new URL('worker-browser.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(new URL('worker-browser.json', output), JSON.stringify({
    passed: false, scenarios: results, page_errors: errors, worker_errors: workerErrors, error: error.message,
  }, null, 2));
  throw error;
} finally {
  await bind(null).catch(() => undefined);
  await context.close();
  if (path.dirname(path.resolve(profile)) !== scratchRoot || !path.basename(profile).startsWith('zea-push-worker-')) {
    throw new Error('Unexpected temporary profile path; cleanup refused');
  }
  await rm(profile, { recursive: true, force: true });
}
