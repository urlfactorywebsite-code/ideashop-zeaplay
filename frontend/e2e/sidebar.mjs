import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_SIDEBAR_TEST_URL || 'http://127.0.0.1:6303';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback harness only');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
let role = 'owner', userId = 'owner-1', tenantId = 'tenant-1';
const errors = [];
await context.addInitScript(() => localStorage.setItem('vee_access_token', 'synthetic-sidebar-token'));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'cdn.tailwindcss.com') return route.continue();
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/__sidebar-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/sidebarFixture.tsx"></script></body></html>` });
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: userId, tenant_id: tenantId, name: 'Sidebar tester', email: 'sidebar@example.test', role, status: 'ACTIVE', unlocked_achievement_ids: [], claimed_reward_ids: [] } });
  if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API: ${url.pathname}`);
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const sidebar = () => page.getByRole('navigation', { name: 'Sidebar', exact: true });
const editor = () => page.getByRole('dialog', { name: 'Edit sidebar', exact: true });
async function open() { await page.goto(`${base}/__sidebar-test`); await sidebar().waitFor(); }
async function clicks(count) { for (let i = 0; i < count; i++) await page.getByRole('button', { name: 'More', exact: true }).click(); }
const labels = () => sidebar().getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('aria-label')));
try {
  await open();
  const original = await labels();
  await clicks(4); assert.equal(await page.getByRole('button', { name: 'Edit sidebar', exact: true }).count(), 0);
  await clicks(1); await page.getByRole('button', { name: 'Edit sidebar', exact: true }).click();
  await editor().getByRole('textbox', { name: 'Name for Dashboard', exact: true }).fill('Mission Hub');
  await editor().getByRole('button', { name: 'Move Dashboard down', exact: true }).click();
  await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await labels(), original);
  await page.getByRole('button', { name: 'Edit sidebar', exact: true }).click();
  await editor().getByRole('textbox', { name: 'Name for Dashboard', exact: true }).fill('Mission Hub');
  const handle = editor().locator('[title="Drag Dashboard"]');
  const start = await handle.boundingBox();
  const target = await editor().getByRole('textbox', { name: 'Name for All Tasks', exact: true }).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, target.y + target.height + 12, { steps: 15 });
  await page.mouse.up();
  assert.equal(await editor().getByRole('textbox').first().getAttribute('aria-label'), 'Name for All Tasks');
  if (process.env.ZEAPLAY_SIDEBAR_SCREENSHOT) {
    await page.waitForTimeout(400); // Let the drag spring settle for visual review.
    await page.screenshot({ path: process.env.ZEAPLAY_SIDEBAR_SCREENSHOT });
  }
  await editor().getByRole('button', { name: 'Save', exact: true }).click();
  assert.deepEqual((await labels()).slice(0, 2), ['All Tasks', 'Mission Hub']);
  assert.equal(await sidebar().getByRole('link', { name: 'Mission Hub', exact: true }).getAttribute('href'), '/dashboard');
  await page.reload(); await sidebar().getByRole('link', { name: 'Mission Hub', exact: true }).waitFor();
  assert.deepEqual((await labels()).slice(0, 2), ['All Tasks', 'Mission Hub']);
  assert.equal(await page.getByRole('button', { name: 'Edit sidebar', exact: true }).count(), 0);
  await clicks(5); await page.getByRole('button', { name: 'Edit sidebar', exact: true }).click();
  await page.keyboard.press('Escape'); await editor().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  assert.equal(await sidebar().getByRole('link', { name: 'Mission Hub', exact: true }).getAttribute('title'), 'Mission Hub');
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  for (const value of ['admin', 'manager', 'user']) {
    role = value; await open(); await clicks(8);
    assert.equal(await page.getByRole('button', { name: 'Edit sidebar', exact: true }).count(), 0);
    assert.equal(await sidebar().getByRole('link', { name: 'Mission Hub', exact: true }).count(), 0);
  }
  role = 'owner'; userId = 'owner-2'; await open(); assert.equal((await labels())[0], 'Dashboard');
  userId = 'owner-1'; tenantId = 'tenant-2'; await open(); assert.equal((await labels())[0], 'Dashboard');
  tenantId = 'tenant-1'; await open(); await sidebar().getByRole('link', { name: 'Mission Hub', exact: true }).waitFor();
  await clicks(5); await page.getByRole('button', { name: 'Edit sidebar', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  const bounds = await editor().boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  await editor().getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await editor().getByRole('button', { name: 'Save', exact: true }).click();
  assert.deepEqual(await labels(), original);
  assert.deepEqual(errors, []);
  console.log('PASS: fifth-click owner unlock, role/tenant/account isolation, rename, drag reorder, cancel, save, reload, reset, collapsed labels, Escape, narrow editor');
} finally { await context.close(); await browser.close(); }
