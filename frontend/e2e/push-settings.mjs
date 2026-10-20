// Actual Settings/AuthProvider/HashRouter and service worker with intercepted APIs.
// PushManager is synthetic: this harness never registers with a push provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_PUSH_TEST_URL || 'http://127.0.0.1:6302';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const output = new URL(process.env.ZEAPLAY_PUSH_OUTPUT || '../../docs/push-notifications/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(process.env.ZEAPLAY_TAILWIND_RUNTIME || new URL('tailwind-test-runtime.js', output), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const theme = index.match(/<style>([\s\S]*?)<\/style>/)[1];
const config = index.match(/<script>\s*(tailwind\.config[\s\S]*?)<\/script>/)[1];
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-settings-browser';
const endpointHash = createHash('sha256').update(endpoint).digest('hex');
const publicKey = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
const stamp = '2026-10-20T08:00:00Z';
const modules = ['tasks', 'tickets', 'chat', 'comments', 'users', 'departments'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [];
const results = [];
const errors = [];
const unmatched = [];
const allWrites = [];
const device = (id, current = false) => ({
  id, endpoint_hash: current ? endpointHash : '0'.repeat(64),
  device_label: current ? 'Win32' : 'Phone', user_agent: current ? 'Chrome/130' : 'Safari/18',
  created_at: stamp, last_seen_at: stamp,
});

async function fixture({ permission = 'granted', supported = true, configured = true, subscribed = true, current = true, role = 'user', width = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', permissions: ['notifications'] });
  contexts.push(ctx);
  const state = {
    devices: [device('current-device', current), device('phone-device')],
    preferences: modules.map(module => ({ module, push_enabled: true })),
    writes: [], failPreferences: false, failDevices: false, delay: 0, reads: 0,
  };
  await ctx.addInitScript(({ endpoint, publicKey, permission, supported, subscribed }) => {
    if (!localStorage.getItem('vee_access_token')) localStorage.setItem('vee_access_token', 'synthetic-push-settings-token');
    if (!localStorage.getItem('synthetic-browser-subscribed')) localStorage.setItem('synthetic-browser-subscribed', subscribed ? 'yes' : 'no');
    let currentPermission = permission;
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => currentPermission });
    Notification.requestPermission = async () => {
      if (currentPermission === 'default') currentPermission = 'granted';
      return currentPermission;
    };
    if (!supported) Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const subscription = () => ({
      endpoint,
      options: { applicationServerKey: key.buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: 'synthetic-p256dh', auth: 'synthetic-auth' } }),
      unsubscribe: async () => { localStorage.setItem('synthetic-browser-subscribed', 'no'); return true; },
    });
    PushManager.prototype.getSubscription = async () => localStorage.getItem('synthetic-browser-subscribed') === 'yes' ? subscription() : null;
    PushManager.prototype.subscribe = async () => { localStorage.setItem('synthetic-browser-subscribed', 'yes'); return subscription(); };
  }, { endpoint, publicKey, permission, supported, subscribed });
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/__push-tailwind.js') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
    if (url.pathname === '/__push-settings') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}</style><script src="/__push-tailwind.js"></script><script>${config}</script></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/pushSettingsFixture.tsx"></script></body></html>` });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = route.request().method();
    const payload = method === 'POST' ? route.request().postDataJSON() : null;
    if (method !== 'GET') {
      const write = { method, path: url.pathname, body: payload };
      state.writes.push(write); allWrites.push(write);
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'synthetic-user', tenant_id: 'synthetic-tenant', role, status: 'ACTIVE', name: 'Push Settings User', email: 'settings@example.com', claimed_reward_ids: [], unlocked_achievement_ids: [] } });
    if (url.pathname === '/api/departments') return route.fulfill({ json: [] });
    if (url.pathname === '/api/push/status') return route.fulfill({ json: {
      configured, public_key_configured: configured, private_key_configured: configured, subject_configured: configured,
      configuration_valid: configured, active_subscription_count: state.devices.length,
    } });
    if (url.pathname === '/api/push/vapid-public-key') return route.fulfill({ json: { public_key: publicKey } });
    if (url.pathname === '/api/push/subscriptions') {
      state.reads += 1;
      if (method === 'DELETE') {
        if (state.failDevices) return route.fulfill({ status: 500, json: { detail: 'Synthetic device removal failure' } });
        state.devices = []; return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: state.devices });
    }
    if (url.pathname.startsWith('/api/push/subscriptions/')) {
      if (state.failDevices) return route.fulfill({ status: 500, json: { detail: 'Synthetic device removal failure' } });
      state.devices = state.devices.filter(row => row.id !== url.pathname.split('/').at(-1));
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/api/push/subscribe') {
      const row = device('current-device', true);
      state.devices = [...state.devices.filter(item => item.id !== row.id), row];
      return route.fulfill({ json: row });
    }
    if (url.pathname === '/api/push/unsubscribe') return route.fulfill({ json: { revoked: true } });
    if (url.pathname === '/api/push/test') return route.fulfill({ json: { accepted: 1, attempted: 1, failed: 0, revoked: 0 } });
    if (url.pathname === '/api/notification/preferences') {
      if (method === 'POST') {
        if (state.failPreferences) return route.fulfill({ status: 500, json: { detail: 'Synthetic preference failure' } });
        for (const change of payload.preferences) {
          const row = state.preferences.find(item => item.module === change.module);
          row.push_enabled = change.push_enabled;
        }
      }
      return route.fulfill({ json: state.preferences });
    }
    unmatched.push(`${method} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { detail: `Unmocked synthetic request ${url.pathname}` } });
  });
  const open = async (hash = '#/settings?tab=push') => {
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/__push-settings${hash}`);
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    if (hash.includes('tab=push')) await ready(page);
    return page;
  };
  return { ctx, state, open };
}

async function ready(page) {
  await page.getByRole('heading', { name: 'Push notifications', exact: true }).waitFor();
  await expect(page.getByRole('switch')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
}
async function status(page, text) { await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible(); }
async function bounds(page, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No page overflow at ${width}px`);
  const controls = await page.locator('#settings-panel-push button:visible').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent, x: box.x, width: box.width, height: box.height };
  }));
  for (const control of controls) {
    assert.ok(control.x >= -1 && control.x + control.width <= width + 1, `${control.label} fits ${width}px`);
    assert.ok(control.height >= 43.9, `${control.label} touch target`);
  }
}

try {
  const { open, state, ctx } = await fixture();
  const page = await open('#/settings');
  await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Profile', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await ready(page);
  await expect(page.getByRole('tab', { name: 'Push notifications', exact: true })).toBeFocused();
  assert.match(page.url(), /#\/settings\?tab=push$/);
  await page.reload(); await ready(page);
  await expect(page.getByRole('tab', { name: 'Push notifications', exact: true })).toHaveAttribute('aria-selected', 'true');
  results.push('Default Profile, keyboard tab selection, hash URL and reload persistence');

  await expect(page.getByText('Enabled for your account', { exact: true })).toBeVisible();
  await expect(page.getByText('Server configuration status', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reconnect this browser', exact: true }).click();
  await status(page, 'This browser is registered for your account');
  assert.equal(state.writes.at(-1).path, '/api/push/subscribe');
  assert.equal(state.devices.length, 2);
  results.push('Reconnect refreshes the existing owned subscription without adding a duplicate device');
  await page.getByRole('button', { name: 'Send test to this browser', exact: true }).click();
  await status(page, 'Test accepted by the push service');
  assert.deepEqual(state.writes.at(-1).body, { subscription_id: 'current-device' });
  results.push('Ordinary user manages own devices and self-test; current browser matches SHA-256 endpoint; administrator diagnostics hidden');

  await page.getByRole('switch', { name: 'Tasks push alerts', exact: true }).click();
  await status(page, 'Push preferences saved');
  assert.deepEqual(state.writes.at(-1).body, { preferences: [{ module: 'tasks', push_enabled: false }] });
  await expect(page.getByRole('switch', { name: 'Tasks push alerts', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.reload(); await ready(page);
  await expect(page.getByRole('switch', { name: 'Tasks push alerts', exact: true })).toHaveAttribute('aria-checked', 'false');
  results.push('Six accessible category switches, single-module writes and saved preferences survive reload');

  await page.getByRole('button', { name: 'Mute all categories', exact: true }).click(); await status(page, 'Push preferences saved');
  assert.equal(state.writes.at(-1).body.preferences.length, 6);
  await expect(page.getByRole('switch', { checked: false })).toHaveCount(6);
  await page.getByRole('button', { name: 'Enable all categories', exact: true }).click(); await status(page, 'Push preferences saved');
  await expect(page.getByRole('switch', { checked: true })).toHaveCount(6);
  results.push('Mute all and enable all persist all six categories');

  state.failPreferences = true;
  await page.getByRole('switch', { name: 'Chat push alerts', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Preferences were not saved' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Push preferences saved' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Chat push alerts', exact: true })).toHaveAttribute('aria-checked', 'true');
  state.failPreferences = false;
  results.push('Failed preference save preserves prior switch value and shows an error without success');

  state.delay = 250;
  const before = state.writes.length;
  await page.getByRole('switch', { name: 'Chat push alerts', exact: true }).evaluate(button => { button.click(); button.click(); });
  await status(page, 'Push preferences saved');
  assert.equal(state.writes.length, before + 1);
  state.delay = 0;
  results.push('Concurrent same-turn preference clicks create exactly one API write');

  const otherPage = await open();
  await otherPage.bringToFront();
  const readCount = state.reads;
  await page.getByRole('switch', { name: 'Tickets push alerts', exact: true }).evaluate(button => button.click());
  await expect(otherPage.getByRole('switch', { name: 'Tickets push alerts', exact: true })).toHaveAttribute('aria-checked', 'false');
  assert.ok(state.reads > readCount);
  results.push('Actual localStorage cross-tab event refreshes preferences and registered devices');
  await otherPage.close(); await page.bringToFront();

  await page.getByRole('button', { name: 'Disable Phone · Safari', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Disable push on this device?', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  const writesBeforeCancel = state.writes.length;
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(state.writes.length, writesBeforeCancel);
  await page.getByRole('button', { name: 'Disable Phone · Safari', exact: true }).click();
  state.failDevices = true;
  await dialog.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Synthetic device removal failure');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  assert.equal(state.devices.length, 2);
  state.failDevices = false;
  await dialog.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await status(page, 'Push disabled on the selected device');
  assert.equal(state.writes.at(-1).path, '/api/push/subscriptions/phone-device');
  await expect(page.getByRole('heading', { name: 'Your registered devices (1)' })).toBeVisible();
  results.push('Per-device confirmation focuses cancel; cancel performs no write, failed delete retains dialog/device, retry removes only selected device');

  await page.getByRole('button', { name: 'Disable all devices', exact: true }).click();
  const allDialog = page.getByRole('dialog', { name: 'Disable push on all devices?', exact: true });
  await allDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Disable all devices', exact: true }).click();
  await allDialog.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await status(page, 'Push disabled on all your registered devices');
  await expect(page.getByText('No registered devices. Enable this browser to start receiving push alerts.', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-browser-subscribed')), 'no');
  results.push('Disable-all confirmation removes own device list, unsubscribes current browser and presents empty state');

  await page.getByRole('button', { name: 'Enable this browser', exact: true }).click();
  await status(page, 'This browser is registered for your account');
  await expect(page.getByText('Enabled for your account', { exact: true })).toBeVisible();
  assert.equal(state.writes.at(-1).path, '/api/push/subscribe');
  results.push('Enable registers browser through actual account binding and mocked PushManager/provider API');

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await bounds(page, width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: new URL('settings-desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.getByRole('button', { name: 'Disable all devices', exact: true }).click();
  const panel = allDialog.locator('[id^="headlessui-dialog-panel-"]');
  await expect(panel).toBeVisible();
  const dialogBox = await panel.boundingBox();
  assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 320);
  const box = await allDialog.getByRole('button', { name: 'Confirm disable' }).boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320);
  await page.screenshot({ path: new URL('settings-mobile-confirmation.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await page.keyboard.press('Escape'); await expect(allDialog).toHaveCount(0);
  await page.screenshot({ path: new URL('settings-mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  results.push('Actual application Tailwind/theme styles fit 320/390/768/1440px with 44px controls and mobile confirmation');

  for (const scenario of [
    { permission: 'denied', label: 'Blocked', expected: 'Open this site’s permissions' },
    { supported: false, label: 'Unavailable', expected: 'Push needs a secure connection' },
    { configured: false, label: 'Setup required', expected: 'Server push delivery needs administrator setup' },
  ]) {
    const example = await fixture(scenario); const testPage = await example.open();
    await expect(testPage.getByText(scenario.label, { exact: true })).toBeVisible();
    await expect(testPage.getByText(scenario.expected, { exact: false })).toBeVisible();
    await expect(testPage.getByRole('button', { name: /^(Enable|Reconnect) this browser$/ })).toBeDisabled();
    await expect(testPage.getByRole('switch')).toHaveCount(6);
    await testPage.close();
  }
  results.push('Blocked permission, unsupported browser and missing server setup show actionable states while retaining category controls');

  const mismatch = await fixture({ current: false });
  const mismatchPage = await mismatch.open();
  await expect(mismatchPage.getByText('Not enabled for your account', { exact: true })).toBeVisible();
  await expect(mismatchPage.getByRole('button', { name: 'Send test to this browser', exact: true })).toBeDisabled();
  await mismatchPage.close();
  results.push('Existing browser subscription without an owned matching endpoint hash is not falsely reported enabled');

  assert.deepEqual(unmatched, [], 'All API requests accounted for');
  assert.deepEqual(errors, [], 'No page errors');
  const report = { passed: true, scenario_count: results.length, scenarios: results, page_errors: errors, unmatched_requests: unmatched, writes: allWrites,
    scope: 'Actual React Settings/AuthProvider/HashRouter/service worker; mocked APIs, browser permission and PushManager. No provider sends.' };
  await writeFile(new URL('ui-browser.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, writes: `${allWrites.length} recorded in ui-browser.json` }, null, 2));
} catch (error) {
  await writeFile(new URL('ui-browser.json', output), JSON.stringify({ passed: false, scenarios: results, page_errors: errors, unmatched_requests: unmatched, error: error.message }, null, 2));
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
