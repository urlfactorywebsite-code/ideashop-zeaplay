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
const base = process.env.ZEAPLAY_MANAGEMENT_TEST_URL || 'http://127.0.0.1:6338';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = process.env.ZEAPLAY_MANAGEMENT_OUTPUT || path.join(tmpdir(), 'zea-management-navigation-20261021');
await mkdir(output, { recursive: true });
const tailwind = process.env.ZEAPLAY_TAILWIND_JS ? await readFile(process.env.ZEAPLAY_TAILWIND_JS) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const cases = [], errors = [], contexts = [];
const check = (name, details = {}) => { cases.push({ case: name, passed: true, ...details }); console.log('PASS ' + name); };

async function setup(role, width = 1440, theme = 'dark', preferences = false, rules = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.addInitScript(({ theme, preferences }) => {
    localStorage.setItem('zenith-task-theme', theme);
    if (preferences) localStorage.setItem('zea.sidebar.v1:settings-fixture:settings-reviewer', JSON.stringify({ order: ['/tasks', '/dashboard', '/media', '/logs'], labels: { '/tasks': 'Saved work', '/dashboard': 'Saved home' } }));
  }, { theme, preferences });
  await context.routeWebSocket('**/socket.io/**', socket => socket.close({ code: 1000, reason: 'Synthetic presence fixture' }));
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
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument(role, rules) });
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
    await expect(page.locator('.settings-hub, .management-hub, [role=alert]').first()).toBeVisible({ timeout: 30000 });
  };
  const calls = () => page.evaluate(() => window.settingsNavigationAudit.calls);
  const clear = () => page.evaluate(() => { window.settingsNavigationAudit.calls.length = 0; });
  return { context, page, entry, go, calls, clear, supportRequests };
}

try {
  const owner = await setup('owner');
  const { page } = owner;
  await owner.go('/management');
  await expect(page).toHaveURL(/#\/management\/users$/);
  const sidebar = page.getByRole('navigation', { name: 'Sidebar', exact: true });
  const management = sidebar.getByRole('link', { name: 'Management', exact: true });
  await expect(management).toHaveCount(1);
  await expect(management).toHaveAttribute('href', '#/management');
  await expect(management).toHaveAttribute('aria-current', 'page');
  assert.equal(await management.locator('svg.lucide-users-round').count(), 1);
  assert.equal(await management.locator('[aria-expanded], .lucide-chevron-down, .lucide-chevron-right').count(), 0);
  for (const name of ['Users', 'Users Management', 'Clients', 'Authorized apps']) await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
  assert.deepEqual(await page.getByRole('tablist', { name: 'Management sections' }).getByRole('tab').allTextContents(), ['Users Management', 'Clients']);
  await expect(page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create User', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByPlaceholder('Search by Employee ID...')).toBeVisible();
  check('Single UsersRound Management sidebar link, no expansion or nested links; existing Users page and Create User dialog render');
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveURL(/#\/management\/clients$/);
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(management).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tab', { name: 'Clients', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('Search clients').fill('Acme');
  await expect.poll(async () => (await owner.calls()).some(call => call.method === 'getClients' && call.args[0].q === 'Acme')).toBe(true);
  await page.getByRole('button', { name: 'New Client', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create Client', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('Existing Clients search and create dialog work inside full-page Management');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Clients', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/#\/management\/users$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/management\/clients$/);
  await page.getByRole('tab', { name: 'Clients', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/#\/management\/users$/);
  check('Route-backed tabs, refresh, browser back/forward, keyboard selection and sidebar highlighting');
  for (const [from, to] of Object.entries({ '/clients?client=review': '/management/clients?client=review', '/admin/users?filter=active': '/management/users?filter=active', '/oauth/applications': '/settings/oauth/authorized-apps', '/settings/api/oauth': '/settings/oauth', '/settings/api/oauth/authorized-apps': '/settings/oauth/authorized-apps', '/api/oauth-apps': '/settings/oauth' })) {
    await owner.go(from);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#' + to);
  }
  await expect(page.getByRole('tab', { name: 'OAuth', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', { name: 'Authorized apps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authorized applications', exact: true })).toBeVisible();
  check('Legacy URLs redirect with query parameters; existing Authorized applications live under Settings OAuth');
  await owner.go('/settings/sidebar-management');
  await expect(page.getByRole('button', { name: 'Main Sidebar Pages', exact: true })).toBeVisible();
  await expect(page.locator('[data-page-id="management"]')).toBeVisible();
  for (const id of ['users','clients','authorized-apps']) await expect(page.locator(`[data-page-id="${id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Management Page Tabs', exact: true }).click();
  for (const id of ['users','clients']) await expect(page.locator(`[data-page-id="${id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Settings Page Tabs', exact: true }).click();
  await expect(page.locator('[data-page-id="settings.oauth"]')).toBeVisible();
  check('Sidebar Management has distinct main-page, Management-tab and Settings-tab policy groups');
  await owner.context.close();

  for (const role of ['owner','admin','manager','user']) {
    const fixture = await setup(role);
    await fixture.go('/settings/oauth');
    await expect(fixture.page.getByRole('tab', { name: 'OAuth', exact: true })).toBeVisible();
    await expect(fixture.page.getByRole('heading', { name: ['owner','admin'].includes(role) ? 'OAuth management' : 'Authorized applications', exact: true })).toBeVisible();
    if (role !== 'user') {
      await fixture.go('/management');
      await expect(fixture.page).toHaveURL(/#\/management\/users$/);
      await expect(fixture.page.getByRole('heading', { name: 'User Management', exact: true })).toBeVisible();
    } else {
      for (const target of ['/management/users', '/management/clients']) {
        await fixture.go(target);
        await expect(fixture.page).toHaveURL(/#\/navigation-unavailable$/);
      }
      assert.ok(!(await fixture.calls()).some(call => ['getTasks', 'getClients'].includes(call.method)));
    }
    check(`${role}: Management and OAuth retain role ceilings`);
    await fixture.context.close();
  }
  for (const [rules, target] of [
    [{ users: { enabled: false } }, '/management/clients'],
    [{ users: { allowedRoles: ['owner'] } }, '/management/clients'],
    [{ users: { hidden: true } }, '/management/clients'],
  ]) {
    const fixture = await setup('manager', 1440, 'dark', false, rules);
    await fixture.go('/management');
    await expect.poll(() => fixture.page.evaluate(() => location.hash)).toBe('#' + target);
    await expect(fixture.page.getByRole('tab', { name: 'Users Management', exact: true })).toHaveCount(0);
    await fixture.go('/management/users');
    await expect(fixture.page).toHaveURL(rules.users.hidden ? /#\/management\/users$/ : /#\/navigation-unavailable$/);
    check(`First accessible tab and direct-route enforcement: ${JSON.stringify(rules)}`);
    await fixture.context.close();
  }
  for (const rules of [{ users: { enabled: false }, clients: { enabled: false } }, { management: { enabled: false } }]) {
    const fixture = await setup('owner', 1440, 'dark', false, rules);
    await fixture.go('/settings/profile');
    await expect(fixture.page.getByRole('navigation', { name: 'Sidebar', exact: true }).getByRole('link', { name: 'Management', exact: true })).toHaveCount(0);
    await fixture.go('/management');
    await expect(fixture.page).toHaveURL(/#\/navigation-unavailable$/);
    check('No Management sidebar entry or direct access when parent/all children disabled');
    await fixture.context.close();
  }
  for (const width of [320,390,768,1024,1440]) {
    const fixture = await setup('owner', width);
    for (const section of ['users','clients']) {
      await fixture.go('/management/' + section);
      await expect(fixture.page.getByRole('heading', { name: section === 'users' ? 'User Management' : 'Clients', exact: true })).toBeVisible();
      assert.ok(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${section} document overflow`);
      await fixture.page.screenshot({path:path.join(output, `management-${section}-${width}.png`), animations:'disabled'});
      if (width < 1024) {
        await fixture.page.getByRole('button', { name: 'Open menu', exact: true }).last().click();
        const menu = fixture.page.locator('.mobile-menu-overlay');
        await expect(menu.getByRole('link', { name: 'Management', exact: true })).toHaveCount(1);
        for (const name of ['Users','Clients','Authorized apps']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
        await menu.getByRole('link', { name: 'Management', exact: true }).click();
        await expect(fixture.page).toHaveURL(/#\/management\/users$/);
      }
    }
    check(`Responsive full-page Management and mobile single-link menu at ${width}px`);
    await fixture.context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({passed:true,cases,errors,scope:'Real app/router/components with synthetic API responses; no deployment or provider delivery.'},null,2));
  console.log(JSON.stringify({passed:true,cases:cases.length}));
} catch (error) {
  await writeFile(path.join(output, 'browser.json'), JSON.stringify({passed:false,cases,errors,error:String(error)},null,2));
  throw error;
} finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); }
