import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_TASK_TEST_URL || 'http://127.0.0.1:16309';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const phase = process.env.ZEAPLAY_PERFORMANCE_PHASE || 'after';
const output = new URL('../../docs/tasks-performance/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], results = [];
try {
  for (const theme of ['dark', 'light', 'colorful']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('zenith-task-theme', theme), theme);
      const requests = [];
      await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => socket.onMessage(() => {}));
      await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => socket.send(JSON.stringify({ type: 'connected' })));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url()); requests.push(url.href);
        if (url.hostname === 'cdn.tailwindcss.com') {
          assert.equal(phase, 'before', 'Runtime Tailwind must not load after optimization');
          return route.fulfill({ contentType: 'text/javascript', body: tailwind });
        }
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/__tasks-performance') {
          const response = await route.fetch({ url: base + '/' });
          return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
        }
        if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
        if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream')
          ? { contentType: 'text/event-stream', body: '' }
          : { json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/__tasks-performance?role=owner#/tasks', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Navigation task 0', { exact: true }).first()).toBeVisible();
      const tabs = page.getByRole('tablist', { name: 'Task views' });
      await expect(tabs.getByRole('tab')).toHaveCount(4);
      const geometry = await page.locator('#tasks-tab-list').evaluate(el => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { width: rect.width, height: rect.height, padding: css.padding, borderRadius: css.borderRadius, fontSize: css.fontSize, display: css.display };
      });
      if (phase === 'after') {
        assert.ok(!requests.some(url => /TaskDocumentation|ClockDropdown|react-md-editor|lottie-web/.test(url)), 'Closed panels must not load their modules');
        await expect(page.locator('.zea-header-video')).toHaveAttribute('poster', '/header-poster.webp');
        assert.ok(requests.some(url => url.endsWith('/header-poster.webp')));
      }
      await page.getByRole('button', { name: /^\+?\s*Create Task$/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Create Task', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.locator('#projectId').click();
      await expect(page.getByRole('option').filter({ hasText: 'Verification project' })).toBeVisible();
      await page.getByRole('option').filter({ hasText: 'Verification project' }).click();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.screenshot({ path: new URL(`${phase}-${theme}-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
      if (phase === 'after' && width === 1440 && theme === 'dark') {
        await page.getByRole('button', { name: 'Open user manual', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Close manual', exact: true })).toBeVisible();
        assert.ok(requests.some(url => url.includes('TaskDocumentation')));
        await page.getByRole('button', { name: 'Close manual', exact: true }).click();
        await page.getByRole('button', { name: 'Open clock assistant', exact: true }).click();
        await expect(page.getByText('This feature is only available for the United States.', { exact: false })).toBeVisible();
        assert.ok(requests.some(url => url.includes('ClockDropdown')));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      results.push({ theme, width, geometry }); console.log(`PASS: ${phase} ${theme} ${width}px`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL(`browser-${phase}.json`, output), JSON.stringify({ results, errors, environment: 'Loopback Chrome; actual App and task UI, synthetic API/session data, external media blocked' }, null, 2) + '\n');
  if (phase === 'after') {
    const before = JSON.parse(await readFile(new URL('browser-before.json', output), 'utf8'));
    assert.deepEqual(results, before.results, 'Tab geometry and typography must match the runtime CSS baseline');
  }
} finally { await browser.close(); }
