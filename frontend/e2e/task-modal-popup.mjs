import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_POPUP_TEST_URL || 'http://127.0.0.1:16309';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../docs/task-modal-popup/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], errors = [], oldPositions = {};
const onTop = locator => locator.evaluate(el => {
  const box = el.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return target === el || el.contains(target);
});
try {
  for (const theme of ['light', 'colorful', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(theme => localStorage.setItem('zenith-task-theme', theme), theme);
    await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => socket.onMessage(() => {}));
    await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/__task-popup') {
        const response = await route.fetch({ url: base + '/' });
        return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
      }
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
      if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
        ? { contentType: 'text/event-stream', body: '' }
        : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push({ theme, message: error.message }));
    await page.goto(base + '/__task-popup?role=owner&rows=60#/tasks', { waitUntil: 'domcontentloaded' });
    const open = page.getByRole('button', { name: /^\+?\s*Create Task$/ });
    const dialog = page.getByRole('dialog', { name: 'Create Task', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const title = dialog.getByRole('heading', { name: 'Create Task', exact: true });
    await expect(open).toBeVisible();
    for (const [width, height] of [[1440, 900], [1366, 768], [1280, 600], [390, 640]]) {
      await page.setViewportSize({ width, height }); await open.click(); await expect(dialog).toBeVisible();
      const geometry = await dialog.evaluate(el => {
        const box = el.getBoundingClientRect();
        return { position: getComputedStyle(el).position, directBodyChild: el.parentElement === document.body,
          x: box.x, y: box.y, width: box.width, height: box.height };
      });
      assert.deepEqual(geometry, { position: 'fixed', directBodyChild: true, x: 0, y: 0, width, height });
      await expect(title).toBeInViewport({ ratio: 1 }); await expect(close).toBeInViewport({ ratio: 1 });
      assert.ok(await onTop(title) && await onTop(close));
      assert.equal(await page.locator('.tasks-hub [role="dialog"]').count(), 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      if (width === 1440 && theme !== 'dark') {
        oldPositions[theme] = await page.locator(`.tasks-${theme}-theme`).evaluate(parent => {
          const probe = document.createElement('div'); probe.className = 'fixed inset-0 z-[90]'; parent.append(probe);
          const position = getComputedStyle(probe).position; probe.remove(); return position;
        });
        assert.equal(oldPositions[theme], 'relative');
      }
      if (width === 1366) await page.screenshot({ path: new URL(`${theme}-desktop.png`, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
      if (width === 1440) {
        await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
        const aiTitle = page.getByRole('heading', { name: 'Generate Task with AI', exact: true });
        await expect(aiTitle).toBeVisible(); assert.ok(await onTop(aiTitle));
        await aiTitle.locator('..').getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(aiTitle).toHaveCount(0);
      }
      const submit = dialog.getByRole('button', { name: 'Create quest', exact: true });
      await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport({ ratio: 1 });
      assert.ok(await onTop(submit)); await expect(close).toBeInViewport({ ratio: 1 });
      await close.click(); await expect(dialog).toHaveCount(0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      results.push({ theme, width, height, geometry, nestedAi: width === 1440 });
      console.log(`PASS: ${theme} ${width}x${height}: fixed popup, header, close, submit and cleanup`);
    }
    await open.click(); await dialog.locator('#title').fill(`${theme} popup verification`);
    await expect(dialog.getByRole('button', { name: 'Project', exact: true })).toContainText('Verification project');
    await dialog.getByRole('button', { name: 'Create quest', exact: true }).click(); await expect(dialog).toHaveCount(0);
    const calls = await page.evaluate(() => window.taskNavigationAudit.calls);
    assert.equal(calls.find(call => call.method === 'createTask').args[0].projectId, 'project-0');
    console.log(`PASS: ${theme}: creation saves selected project and closes the popup`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ results, oldPositions, errors }, null, 2));
} finally { await browser.close(); }
