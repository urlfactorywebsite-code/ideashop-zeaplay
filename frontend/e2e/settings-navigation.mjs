import { navigationDocument } from './navigation-fixture.mjs';
// Runs the real application/router with synthetic service responses on loopback.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
const { chromium, expect } = await import(pathToFileURL(modulePath).href);
const base = process.env.ZEAPLAY_SETTINGS_TEST_URL || 'http://127.0.0.1:6337';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = process.env.ZEAPLAY_SETTINGS_OUTPUT || path.join(tmpdir(), 'zea-settings-refactor-20261021');
await mkdir(output, { recursive: true });
const tailwind = process.env.ZEAPLAY_TAILWIND_JS ? await readFile(process.env.ZEAPLAY_TAILWIND_JS) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const cases = [], errors = [], contexts = [];
const check = (name, details = {}) => { cases.push({ case: name, passed: true, ...details }); console.log('PASS ' + name); };
const headings = { profile: 'Profile information', support: 'Submit Support Request',
  'sidebar-management': 'Sidebar Management', oauth: 'OAuth management', api: 'API & OAuth Management', logs: 'Audit Logs', 'media-library': 'Media Library', push: 'Push notifications' };
const paths = { 'General / Profile': 'profile', Support: 'support', API: 'api', OAuth: 'oauth', Logs: 'logs', 'Media Library': 'media-library', 'Sidebar Management': 'sidebar-management', 'Push notifications': 'push' };

async function setup(role, width = 1440, theme = 'dark', preferences = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.addInitScript(({ theme, preferences }) => {
    localStorage.setItem('zenith-task-theme', theme);
    if (preferences) localStorage.setItem('zea.sidebar.v1:settings-fixture:settings-reviewer', JSON.stringify({ order: ['/tasks', '/dashboard', '/media', '/logs'], labels: { '/tasks': 'Saved work', '/dashboard': 'Saved home' } }));
  }, { theme, preferences });
  await context.routeWebSocket('**/api/ws/**', socket => socket.close({ code: 1000, reason: 'Synthetic navigation fixture' }));
  // HMR is test infrastructure, not an app socket. Keep its client connected
  // without depending on Chrome's loopback-network permission prompt.
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => {
    socket.send(JSON.stringify({ type: 'connected' }));
    socket.onMessage(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ role, width, error: error.message }));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 500) errors.push({ role, width, error:'HTTP '+response.status()+' '+new URL(response.url()).pathname }); });
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push({ role, width, error: message.text() });
  });
  const supportRequests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com' && tailwind) return route.fulfill({ contentType: 'text/javascript', body: tailwind });
    if (url.origin === base) {
      if (url.pathname === '/__settings-navigation') {
        const response = await route.fetch({ url: base + '/' });
        return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/settingsNavigationFixture.tsx"') });
      }
      if (url.pathname === '/pages/Dashboard.tsx') return route.fulfill({ contentType: 'text/javascript', body: 'export default function Dashboard(){return "Dashboard"}' });
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument(role) });
      if (url.pathname === '/api/support/requests') {
        supportRequests.push(route.request().postDataJSON());
        return route.fulfill({ json: { accepted: true } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
        ? { contentType: 'text/event-stream', body: '' } : { json: url.pathname.endsWith('/websocket-ticket') ? { ticket: 'synthetic-ticket' } : [] });
      return route.continue();
    }
    if (url.hostname === 'n8n.urlfactory.website') {
      if (route.request().method() === 'POST') supportRequests.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true }, headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'Content-Type' } });
    }
    if (['res.cloudinary.com', 'storage.googleapis.com', 'cdn.tailwindcss.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const entry = `${base}/__settings-navigation?role=${role}`;
  const go = async target => {
    await page.goto(`${entry}#${target}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30000 });
  };
  const calls = () => page.evaluate(() => window.settingsNavigationAudit.calls);
  const clear = () => page.evaluate(() => { window.settingsNavigationAudit.calls.length = 0; });
  return { context, page, entry, go, calls, clear, supportRequests };
}

try {
  const owner = await setup('owner');
  const { page } = owner;
  await owner.go('/settings');
  await expect(page).toHaveURL(/#\/settings\/profile$/);
  await expect(page.getByRole('heading', { name: headings.profile })).toBeVisible();
  await page.getByLabel('Full / display name', { exact: true }).fill('Unsaved profile draft');
  const profileLoads = (await owner.calls()).filter(call => call.method === 'getDepartments').length;
  await page.getByRole('tab', { name: 'Push notifications', exact: true }).click();
  await page.getByRole('tab', { name: 'General / Profile', exact: true }).click();
  await expect(page.getByLabel('Full / display name', { exact: true })).toHaveValue('Unsaved profile draft');
  assert.equal((await owner.calls()).filter(call => call.method === 'getDepartments').length, profileLoads);
  check('Profile drafts and metadata requests survive Settings tab changes');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const name of ['Media Library', 'Logs', 'API', 'OAuth', 'SMTP', 'Support', 'Master Control', 'Profile']) await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  check('Permanent Settings link, removed standalone links and removed footer dropdown');

  for (const [label, section] of Object.entries(paths)) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: headings[section], exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  check('All six requested tabs and retained Push notifications render existing components');

  await page.getByRole('tab', { name: 'General / Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: headings.profile })).toBeVisible();
  await page.getByLabel('Full / display name', { exact: true }).fill('Updated Reviewer');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  assert.ok((await owner.calls()).some(call => call.method === 'updateCurrentUserProfile' && call.args[1].name === 'Updated Reviewer'));
  const password = page.locator('input[type="password"]');
  await password.nth(0).fill('SyntheticOld9!'); await password.nth(1).fill('SyntheticNew9!'); await password.nth(2).fill('Mismatch9!');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  assert.equal((await owner.calls()).filter(call => call.method === 'changeCurrentUserPassword').length, 0);
  await password.nth(2).fill('SyntheticNew9!'); await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByText('Password updated. New credentials are active immediately.')).toBeVisible();
  check('Profile save and existing password validation/submission use unchanged service methods');

  await page.getByRole('tab', { name: 'Support', exact: true }).click();
  await page.getByLabel('Subject *', { exact: true }).fill('Synthetic navigation check');
  await page.getByLabel('Category *', { exact: true }).selectOption('Bug');
  await page.getByLabel('Priority *', { exact: true }).selectOption('Low');
  await page.getByLabel('Description *', { exact: true }).fill('Synthetic local-only support form verification.');
  await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
  await expect(page.getByText('Your support request has been sent successfully.')).toBeVisible();
  assert.equal(owner.supportRequests[0].subject, 'Synthetic navigation check');
  check('Inline Support reuses the existing payload and form; external delivery intercepted');

  await expect(page.getByRole('tab', { name: 'Master Control', exact: true })).toHaveCount(0);
  await owner.go('/settings/master-control');
  await expect(page).toHaveURL(/#\/settings\/profile$/);
  assert.equal((await owner.calls()).filter(call => call.method === 'updateFeatureFlags').length, 0);
  check('Master Control is removed and its previous Settings route returns to profile');

  await page.getByRole('tab', { name: 'API', exact: true }).click();
  const apiNav = page.getByRole('navigation', { name: 'API settings', exact: true });
  for (const [label, heading] of [['Documentation', 'Endpoint Catalogue'], ['Bearer Key Builder', 'Generate Bearer Key'], ['Webhooks', 'Webhook events']]) {
    await apiNav.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'OAuth', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OAuth management', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Register application', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  await apiNav.getByRole('link', { name: 'SMTP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SMTP Management', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New SMTP profile', exact: true }).click();
  await expect(page.locator('.smtp-management form')).toBeVisible();
  check('Existing OAuth registration and SMTP profile forms remain reachable');

  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await page.getByPlaceholder('Search actor, action, entity, IP...').fill('synthetic-filter');
  await page.getByPlaceholder('TASK_UPDATED', { exact: true }).fill('TASK_UPDATED');
  await expect.poll(async () => (await owner.calls()).some(call => call.method === 'getAuditLogs' && JSON.stringify(call.args).includes('TASK_UPDATED'))).toBe(true);
  await page.getByRole('tab', { name: 'Media Library', exact: true }).click();
  await page.getByPlaceholder('Search filename...').fill('synthetic-image');
  await expect.poll(async () => (await owner.calls()).some(call => call.method === 'listMediaFiles' && call.args[0].search === 'synthetic-image')).toBe(true);
  check('Logs and Media Library retain filtering and their existing API methods');

  await owner.go('/settings/profile?keep=one');
  await page.getByRole('tab', { name: 'Support', exact: true }).click();
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await page.goBack(); await expect(page).toHaveURL(/#\/settings\/support\?keep=one$/);
  await page.goForward(); await expect(page).toHaveURL(/#\/settings\/logs\?keep=one$/);
  await page.reload(); await expect(page.getByRole('heading', { name: headings.logs, exact: true })).toBeVisible();
  check('Canonical deep links, query strings, reload and browser back/forward');

  const legacy = { '/support': '/settings/support', '/master-control': '/settings/profile', '/logs': '/settings/logs', '/media': '/settings/media-library',
    '/api/overview': '/settings/api/overview', '/api/oauth-apps': '/settings/oauth', '/api/smtp': '/settings/api/smtp', '/settings?tab=push': '/settings/push' };
  for (const [from, target] of Object.entries(legacy)) {
    await owner.go(from + (from.includes('?') ? '&' : '?') + 'keep=legacy');
    await expect.poll(() => page.url()).toBe(`${owner.entry}#${target}?keep=legacy`);
  }
  await page.evaluate(() => {
    history.replaceState({ ...history.state, usr: { navigationMarker: 'preserved' } }, '', location.pathname + location.search + '#/logs?keep=state');
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  await expect(page).toHaveURL(/#\/settings\/logs\?keep=state$/);
  assert.equal(await page.evaluate(() => history.state.usr.navigationMarker), 'preserved');
  check('Every legacy route redirects without losing query parameters or navigation state');

  await page.getByRole('tab', { name: 'General / Profile', exact: true }).click();
  await page.getByRole('tab', { name: 'General / Profile', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Support', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'Push notifications', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: 'General / Profile', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('title', 'Settings');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Open release notes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Product Updates', exact: true })).toBeVisible();
  check('Keyboard tabs, collapsed Settings link and preserved release notes');
  await owner.context.close();

  for (const [role, labels, denied] of [
    ['user', ['General / Profile', 'Support', 'OAuth', 'Media Library', 'Push notifications'], ['api/overview', 'api/smtp', 'logs']],
    ['manager', ['General / Profile', 'Support', 'OAuth', 'Logs', 'Media Library', 'Push notifications'], ['api/overview', 'api/smtp']],
    ['admin', ['General / Profile', 'Support', 'API', 'OAuth', 'Logs', 'Media Library', 'Sidebar Management', 'Push notifications'], ['api/overview', 'api/token', 'api/documentation', 'api/webhooks']],
  ]) {
    const fixture = await setup(role);
    await fixture.go('/settings/profile');
    assert.deepEqual(await fixture.page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab').allTextContents(), labels);
    await expect(fixture.page.getByRole('button', { name: 'Edit sidebar', exact: true })).toHaveCount(0);
    for (const target of denied) {
      await fixture.page.goto(`${fixture.entry}#/settings/${target}`, { waitUntil: 'domcontentloaded' });
      await expect(fixture.page).toHaveURL(/#\/navigation-unavailable$/);
      assert.ok(!(await fixture.calls()).some(call => ['getAuditLogs', 'getFeatureFlags', 'getSmtpManagement', 'listWebhooks', 'oauth.dashboard'].includes(call.method)));
    }
    if (role === 'admin') {
      for (const target of ['smtp']) {
        await fixture.go(`/settings/api/${target}`);
        await expect(fixture.page.getByRole('heading', { name: target === 'oauth' ? 'OAuth management' : 'SMTP Management', exact: true })).toBeVisible();
        assert.equal(await fixture.page.getByRole('navigation', { name: 'API settings' }).getByRole('link').count(), 1);
      }
    }
    check(`${role}: authorized tabs only and restricted direct URLs blocked before service calls`);
    await fixture.context.close();
  }

  const customized = await setup('owner', 1440, 'dark', true);
  await customized.go('/settings/profile');
  const customNav = customized.page.getByRole('navigation', { name: 'Sidebar', exact: true });
  assert.deepEqual((await customNav.getByRole('link').allTextContents()).slice(0, 2), ['Saved work', 'Saved home']);
  await expect(customized.page.getByRole('button', { name: 'Edit sidebar', exact: true })).toHaveCount(0);
  await expect(customNav.getByRole('link', { name: 'Saved work', exact: true })).toBeVisible();
  check('Owner account/tenant sidebar preferences survive removal of obsolete entries');
  await customized.context.close();

  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    const fixture = await setup('owner', width, width === 390 ? 'light' : 'dark');
    await fixture.go('/settings/profile');
    for (const [label, section] of Object.entries(paths)) {
      await fixture.page.getByRole('tab', { name: label, exact: true }).focus();
      await fixture.page.keyboard.press('Enter');
      await expect(fixture.page.getByRole('heading', { name: headings[section], exact: true })).toBeVisible();
      const box = await fixture.page.locator('.settings-hub').boundingBox();
      assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `${width}px ${section} Settings overflow`);
      assert.ok(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${section} document overflow`);
    }
    if (width < 1024) {
      await fixture.page.getByRole('button', { name: 'Open menu', exact: true }).last().click();
      const menu = fixture.page.locator('.mobile-menu-overlay');
      await expect(menu.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      for (const label of ['Media', 'Logs', 'API', 'SMTP']) await expect(menu.getByRole('link', { name: label, exact: true })).toHaveCount(0);
      await menu.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(fixture.page).toHaveURL(/#\/settings\/profile$/);
      await expect(fixture.page.getByRole('heading', { name: headings.profile, exact: true })).toBeVisible();
      await expect.poll(async () => {
        const item = await fixture.page.getByRole('tab', { name: 'General / Profile', exact: true }).boundingBox();
        const frame = await fixture.page.getByRole('tablist', { name: 'Settings sections' }).boundingBox();
        return item.x >= frame.x - 1 && item.x + item.width <= frame.x + frame.width + 1;
      }).toBe(true);
    }
    await fixture.page.screenshot({ path: path.join(output, `settings-${width}.png`), animations: 'disabled' });
    check(`Responsive tabs and navigation at ${width}px`);
    await fixture.context.close();
  }
  assert.deepEqual(errors, []);
  check('No browser page errors');
  const report = { passed: true, cases, browser_errors: errors, limitations: ['Synthetic API responses; no production deployment, email, provider upload, or push delivery.'] };
  await writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, cases: cases.length }));
} catch (error) {
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({ passed: false, cases, browser_errors: errors, error: error.message }, null, 2));
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser.close();
}
