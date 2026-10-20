// Real Settings -> FastAPI/authentication -> isolated PostgreSQL.
// Only PushManager and the server's outbound provider transport are synthetic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const output = new URL(process.env.ZEAPLAY_PUSH_OUTPUT || '../../docs/push-notifications/checks/', import.meta.url);
const runtime = JSON.parse((await readFile(new URL('runtime-location.json', output), 'utf8')).replace(/^\uFEFF/, ''));
const ready = JSON.parse(await readFile(`${runtime.runtime_directory}/ready.json`, 'utf8'));
if (!ready.schema.startsWith('push_browser_')) throw new Error('Synthetic private schema required');
const base = process.env.ZEAPLAY_PUSH_TEST_URL || 'http://127.0.0.1:6302';
const backend = runtime.host;
for (const value of [base, backend]) {
  if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('Loopback only');
}
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('tailwind-test-runtime.js', output), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const theme = index.match(/<style>([\s\S]*?)<\/style>/)[1];
const config = index.match(/<script>\s*(tailwind\.config[\s\S]*?)<\/script>/)[1];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['notifications'], reducedMotion: 'reduce' });
const results = [], errors = [], requests = [];
const headers = role => ({ Authorization: `Bearer ${ready.tokens[role]}` });
const snapshot = async () => {
  const response = await context.request.get(`${backend}/__audit__/snapshot`, { headers: headers('owner') });
  assert.equal(response.status(), 200);
  return response.json();
};
const api = async (method, path, role, data) => context.request.fetch(`${backend}/api${path}`, {
  method, headers: role ? headers(role) : {}, data,
});
const binding = page => page.evaluate(async () => {
  const cache = await caches.open('zea-push-account-v1');
  const value = await cache.match(`${location.origin}/__zea_push_account__`);
  return value ? value.json() : null;
});
const currentEndpoint = page => page.evaluate(() => localStorage.getItem('synthetic-live-endpoint'));
const activeRows = (data, role) => data.subscriptions.filter(row => row.user_id === ready.users[role].id && !row.revoked);
const waitFor = async (check, label) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
};
const waitReady = async page => {
  await page.getByRole('heading', { name: 'Push notifications', exact: true }).waitFor();
  await expect(page.getByRole('switch')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
};
await context.addInitScript(({ key, browserKeys }) => {
  const applicationKey = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  const subscription = endpoint => ({
    endpoint,
    options: { applicationServerKey: applicationKey.buffer },
    toJSON: () => ({ endpoint, keys: browserKeys }),
    unsubscribe: async () => { localStorage.removeItem('synthetic-live-endpoint'); return true; },
  });
  PushManager.prototype.getSubscription = async () => {
    const endpoint = localStorage.getItem('synthetic-live-endpoint');
    return endpoint ? subscription(endpoint) : null;
  };
  PushManager.prototype.subscribe = async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/synthetic-live-${crypto.randomUUID()}`;
    localStorage.setItem('synthetic-live-endpoint', endpoint);
    return subscription(endpoint);
  };
}, { key: ready.public_key, browserKeys: ready.browser_keys });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (url.pathname === '/__push-tailwind.js') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
  if (url.pathname === '/__push-live-bootstrap') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local push audit</title>' });
  if (url.pathname === '/__push-live') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}</style><script src="/__push-tailwind.js"></script><script>${config}</script></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/pushLiveFixture.tsx"></script></body></html>` });
  if (url.pathname.startsWith('/api/')) {
    // Transparent loopback transport: every API response is returned by FastAPI.
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` });
    requests.push({ method: route.request().method(), path: url.pathname, status: response.status() });
    return route.fulfill({ response });
  }
  return route.continue();
});

try {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/__push-live-bootstrap`);
  await page.evaluate(token => localStorage.setItem('vee_access_token', token), ready.tokens.user);
  await page.goto(`${base}/__push-live#/settings?tab=push`);
  await waitReady(page);
  await expect(page.getByRole('heading', { name: 'Your registered devices (1)' })).toBeVisible();
  await expect(page.getByText('Not enabled for your account', { exact: true })).toBeVisible();
  const before = await snapshot();
  await writeFile(new URL('live-before.json', output), JSON.stringify(before, null, 2));
  results.push('Real ordinary-user authentication loads one own device and all preferences');

  await page.getByRole('button', { name: 'Enable this browser', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'This browser is registered for your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your registered devices (2)' })).toBeVisible();
  await expect(page.getByText('Enabled for your account', { exact: true })).toBeVisible();
  const endpoint = await currentEndpoint(page);
  assert.ok(endpoint);
  const hash = createHash('sha256').update(endpoint).digest('hex');
  const registered = await snapshot();
  const browserRow = activeRows(registered, 'user').find(row => row.endpoint_hash === hash);
  assert.ok(browserRow);
  assert.deepEqual(await binding(page), { userId: ready.users.user.id, tenantId: ready.users.user.tenant_id });
  results.push('Enable persists a real PostgreSQL subscription, endpoint hash and acknowledged worker account binding');

  const duplicate = await api('POST', '/push/subscribe', 'user', {
    endpoint, keys: ready.browser_keys, device_label: 'Audit browser', user_agent: 'Chrome/130',
  });
  assert.equal(duplicate.status(), 200);
  assert.equal((await duplicate.json()).id, browserRow.id);
  assert.equal(activeRows(await snapshot(), 'user').length, 2);
  results.push('Repeated authenticated registration preserves the original subscription ID and produces no duplicate');

  await page.getByRole('switch', { name: 'Tasks push alerts', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Push preferences saved' })).toBeVisible();
  let persisted = await snapshot();
  assert.equal(persisted.preferences.find(row => row.user_id === ready.users.user.id && row.module === 'tasks').push_enabled, false);
  await page.reload(); await waitReady(page);
  await expect(page.getByRole('switch', { name: 'Tasks push alerts', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Mute all categories', exact: true }).click();
  await expect(page.getByRole('switch', { checked: false })).toHaveCount(6);
  persisted = await snapshot();
  assert.equal(persisted.preferences.filter(row => row.user_id === ready.users.user.id && !row.push_enabled).length, 6);
  results.push('Single-category and mute-all writes persist in PostgreSQL and survive a real page reload');

  const acceptsBefore = (await snapshot()).provider_acceptances.length;
  await page.getByRole('button', { name: 'Send test to this browser', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test accepted by the push service' })).toBeVisible();
  await expect(page.getByText('Browser and operating system settings can still hide it.', { exact: false })).toBeVisible();
  const accepted = (await snapshot()).provider_acceptances.slice(acceptsBefore);
  assert.equal(accepted.length, 1);
  assert.deepEqual(accepted[0], {
    recipient_user_id: ready.users.user.id, recipient_tenant_id: ready.users.user.tenant_id,
    event_type: 'push.test', url: '/#/settings?tab=push',
  });
  results.push('Targeted self-test invokes one synthetic provider acceptance stamped with the authenticated user/tenant; UI states acceptance accurately');

  assert.equal((await api('GET', '/push/subscriptions')).status(), 401);
  assert.equal((await api('GET', '/push/subscriptions', 'inactive')).status(), 403);
  assert.equal((await api('POST', '/push/test', 'user', { subscription_id: ready.subscription_ids.foreign_phone })).status(), 404);
  assert.equal((await api('POST', '/push/subscribe', 'foreign', { endpoint, keys: ready.browser_keys })).status(), 409);
  assert.equal((await api('DELETE', `/push/subscriptions/${browserRow.id}`, 'foreign')).status(), 204);
  assert.equal((await api('DELETE', `/push/subscriptions/${ready.subscription_ids.foreign_phone}`, 'user')).status(), 204);
  assert.equal((await api('POST', '/push/unsubscribe', 'foreign', { endpoint })).status(), 204);
  const protectedState = await snapshot();
  assert.equal(protectedState.subscriptions.find(row => row.id === browserRow.id).revoked, false);
  assert.equal(protectedState.subscriptions.find(row => row.id === ready.subscription_ids.foreign_phone).revoked, false);
  results.push('Real API enforces unauthenticated401, inactive403, foreign-target404, endpoint-transfer409; idempotent foreign removals leave both tenants unchanged');

  await page.getByRole('button', { name: 'Disable Audit phone', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Disable push on this device?', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await snapshot()).subscriptions.find(row => row.id === ready.subscription_ids.user_phone).revoked, false);
  await page.getByRole('button', { name: 'Disable Audit phone', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your registered devices (1)' })).toBeVisible();
  assert.equal((await snapshot()).subscriptions.find(row => row.id === ready.subscription_ids.user_phone).revoked, true);
  results.push('Real device confirmation cancel preserves its row; confirm revokes only the selected own phone');

  await page.getByRole('button', { name: 'Disable all devices', exact: true }).click();
  await page.getByRole('dialog', { name: 'Disable push on all devices?', exact: true }).getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await expect(page.getByText('No registered devices. Enable this browser to start receiving push alerts.', { exact: true })).toBeVisible();
  assert.equal(activeRows(await snapshot(), 'user').length, 0);
  assert.equal(await currentEndpoint(page), null);
  assert.equal((await snapshot()).preferences.filter(row => row.user_id === ready.users.user.id && !row.push_enabled).length, 6);
  results.push('Revoke-all commits own device revocations, clears browser subscription and preserves alert preferences');

  await page.getByRole('button', { name: 'Enable this browser', exact: true }).click();
  await expect(page.getByText('Enabled for your account', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole('heading', { name: 'Your registered devices (1)' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('settings-live-mobile-devices.png', output)), animations: 'disabled' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL('settings-live-mobile.png', output)), animations: 'disabled' });
  const otherPage = await context.newPage();
  otherPage.on('pageerror', error => errors.push(error.message));
  await otherPage.goto(`${base}/__push-live#/settings?tab=push`);
  await waitReady(otherPage);
  const userDevicesBeforeSwitch = activeRows(await snapshot(), 'user').length;
  await page.evaluate(token => localStorage.setItem('vee_access_token', token), ready.tokens.foreign);
  await expect(otherPage.getByRole('heading', { name: 'Your registered devices (1)' })).toBeVisible();
  await expect(otherPage.getByText('Not enabled for your account', { exact: true })).toBeVisible();
  await waitFor(async () => (await binding(otherPage))?.userId === ready.users.foreign.id, 'new account worker binding');
  const writesBeforeStaleAction = requests.filter(request => request.method !== 'GET').length;
  await page.getByRole('button', { name: 'Disable this browser', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your account changed' })).toBeVisible();
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBeforeStaleAction);
  assert.equal(activeRows(await snapshot(), 'user').length, userDevicesBeforeSwitch);
  assert.equal((await binding(otherPage)).userId, ready.users.foreign.id);
  await otherPage.getByRole('button', { name: 'Enable this browser', exact: true }).click();
  await expect(otherPage.getByText('Enabled for your account', { exact: true })).toBeVisible();
  assert.equal(activeRows(await snapshot(), 'foreign').length, 2);
  results.push('Shared-token account switch authenticates other tab, rejects stale-tab actions and binds/registers only the new account');

  await otherPage.getByRole('button', { name: 'Sign out of audit session', exact: true }).click();
  await expect(otherPage.getByRole('status', { name: '', exact: true })).toHaveText('Signed out of the audit session.');
  await waitFor(async () => (await binding(otherPage)) === null && (await currentEndpoint(otherPage)) === null, 'logout cleanup');
  await waitFor(async () => activeRows(await snapshot(), 'foreign').length === 1, 'server logout revocation');
  assert.equal((await snapshot()).subscriptions.find(row => row.id === ready.subscription_ids.foreign_phone).revoked, false);
  results.push('Actual AuthProvider logout clears worker binding and browser subscription, revokes current server endpoint and preserves other devices');

  const after = await snapshot();
  await writeFile(new URL('live-after.json', output), JSON.stringify(after, null, 2));
  assert.deepEqual(errors, []);
  const report = { passed: true, scenario_count: results.length, scenarios: results, page_errors: errors, requests,
    backend: 'Real FastAPI routers/authentication and isolated PostgreSQL schema',
    provider: 'Synthetic server webpush returns201; browser PushManager mocked with valid synthetic keys',
    limitations: ['No external push provider contacted.', 'Does not prove encryption, provider delivery or a visible OS notification.'] };
  await writeFile(new URL('live-browser.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, requests: `${requests.length} status-only records in live-browser.json` }, null, 2));
} catch (error) {
  await writeFile(new URL('live-browser.json', output), JSON.stringify({
    passed: false, scenarios: results, page_errors: errors, requests, error: error.message,
  }, null, 2));
  throw error;
} finally {
  await context.close(); await browser.close();
}
