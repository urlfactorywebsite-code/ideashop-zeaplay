import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16309';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const output = new URL('../../docs/task-navigation-compatibility/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const passed = [], errors = [];

async function scenario({ role = 'owner', width = 1440, legacy = true, rules = {}, before = false, expected = 'allowed' }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  let document = navigationDocument(role, rules);
  if (legacy) document.pages = document.pages.filter(page => page.id !== 'tasks.list');
  let reproducedOldLookup = false;
  await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => socket.onMessage(() => {}));
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__task-compatibility') {
      const response = await route.fetch({ url: base + '/' });
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
    }
    if (before && url.pathname === '/hooks/useNavigation.tsx') {
      const response = await route.fetch();
      const body = await response.text();
      assert.ok(body.includes('resolveNavigationPage(current, id)'));
      reproducedOldLookup = true;
      return route.fulfill({ response, body: body.replace('resolveNavigationPage(current, id)', 'current?.pages.find((entry) => entry.id === id)') });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({ json: document });
    if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
      ? { contentType: 'text/event-stream', body: '' }
      : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/__task-compatibility?role=${role}#/tasks`, { waitUntil: 'domcontentloaded' });
    if (expected === 'allowed' || expected === 'hidden') {
      await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('tab', { name: 'All Tasks', exact: true })).toHaveCount(expected === 'hidden' ? 0 : 1);
      await expect(page).toHaveURL(/#\/tasks$/);
      await page.reload();
      await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    } else {
      await expect(page.getByRole('heading', { name: expected === 'disabled' ? 'Module disabled' : 'Access forbidden', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => window.taskNavigationAudit.calls.filter(call => call.method === 'getTasksPage').length), 0);
    }
    if (before) assert.equal(reproducedOldLookup, true);
    const label = `${before ? 'old lookup reproduction' : 'fixed'}: ${role}, ${width}px, ${legacy ? 'legacy' : 'current'} document, ${expected}`;
    passed.push(label); console.log('PASS: ' + label);
  } finally { await context.close(); }
}

try {
  await scenario({ before: true, expected: 'forbidden' });
  for (const role of ['owner', 'admin', 'manager', 'user']) {
    for (const width of [1440, 390]) await scenario({ role, width });
  }
  await scenario({ rules: { tasks: { enabled: false } }, expected: 'disabled' });
  await scenario({ rules: { tasks: { allowedRoles: ['admin'] } }, expected: 'forbidden' });
  await scenario({ rules: { tasks: { hidden: true } }, expected: 'hidden' });
  await scenario({ legacy: false });
  await scenario({ legacy: false, rules: { 'tasks.list': { allowedRoles: [] } }, expected: 'forbidden' });
  await scenario({ legacy: false, rules: { 'tasks.list': { enabled: false } }, expected: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser.json', output), JSON.stringify({ passed, errors, environment: 'Loopback Chrome; actual App and navigation provider; synthetic API/session data' }, null, 2) + '\n');
} finally { await browser.close(); }
