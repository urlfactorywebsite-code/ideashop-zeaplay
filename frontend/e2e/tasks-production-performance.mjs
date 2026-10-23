import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 30_000 });
const base = process.env.ZEAPLAY_PRODUCTION_TEST_URL || 'http://127.0.0.1:16310';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../docs/tasks-performance/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const baseline = JSON.parse(await readFile(new URL('browser-before.json', output), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], results = [];
const user = { id: 'production-reviewer', tenant_id: 'synthetic-performance', name: 'Performance Reviewer', email: 'reviewer@example.test', role: 'owner', status: 'ACTIVE' };
const task = { id: 'production-task', title: 'Production build task', description: 'Synthetic response through real API mapping', status: 'TODO', priority: 'HIGH',
  created_by_id: user.id, assigned_to_ids: [user.id], created_at: '2026-10-23T06:00:00Z', updated_at: '2026-10-23T06:00:00Z', subtasks: [], tags: [], attachments: [] };
try {
  for (const theme of ['dark', 'light', 'colorful']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('zenith-task-theme', theme), theme);
      const requests = [];
      await context.routeWebSocket(url => /\/(?:api\/)?ws\/tasks$/.test(url.pathname), socket => socket.onMessage(() => {}));
      await context.route('**/*', route => {
        const url = new URL(route.request().url()); requests.push(url.href);
        assert.ok(!/cdn.tailwindcss.com|frappe-gantt|fullcalendar.*main.min.css/.test(url.href), 'No obsolete runtime/CDN request');
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/api/auth/browser-session/refresh') return route.fulfill({ json: { access_token: 'synthetic-production-session', refresh_token: 'synthetic-refresh' } });
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
        if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
        if (url.pathname === '/api/users') return route.fulfill({ json: [user] });
        if (url.pathname === '/api/tasks/page') return route.fulfill({ json: { items: [task], page: 1, page_size: 50, total: 1, total_pages: 1, status_counts: { TODO: 1 } } });
        if (url.pathname === '/api/projects') return route.fulfill({ json: { items: [], page: 1, page_size: 100, total: 0, total_pages: 1 } });
        if (url.pathname === '/api/time-entries/work/active') return route.fulfill({ json: { items: [], running_count: 0, limit: 5, server_time: new Date().toISOString(), user_id: user.id, tenant_id: user.tenant_id } });
        if (url.pathname.endsWith('/notifications/stream')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
        if (url.pathname.endsWith('/websocket-ticket')) return route.fulfill({ json: { access_token: 'synthetic-ticket' } });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#/tasks', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(task.title, { exact: true }).first()).toBeVisible();
      const geometry = await page.locator('#tasks-tab-list').evaluate(el => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { width: rect.width, height: rect.height, padding: css.padding, borderRadius: css.borderRadius, fontSize: css.fontSize, display: css.display };
      });
      assert.deepEqual(geometry, baseline.results.find(result => result.theme === theme && result.width === width).geometry);
      await expect(page.locator('.zea-header-video')).toHaveAttribute('poster', '/header-poster.webp');
      assert.ok(!requests.some(url => /TaskDocumentation-|ClockDropdown-/.test(url)), 'Deferred chunks must stay unloaded initially');
      const timing = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const poster = resources.find(entry => entry.name.endsWith('/header-poster.webp'));
        const entry = resources.find(entry => /\/assets\/index-.*\.js$/.test(entry.name));
        return { posterStart: poster?.startTime, posterInitiator: poster?.initiatorType, entryEnd: entry?.responseEnd };
      });
      assert.equal(timing.posterInitiator, 'link');
      assert.ok(timing.posterStart <= timing.entryEnd, 'Poster must be discovered before entry JavaScript finishes loading');
      if (theme === 'dark' && width === 1440) {
        await page.getByRole('button', { name: 'Open user manual', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Close manual', exact: true })).toBeVisible();
        assert.ok(requests.some(url => url.includes('TaskDocumentation-')));
        await page.getByRole('button', { name: 'Close manual', exact: true }).click();
        await page.getByRole('button', { name: 'Open clock assistant', exact: true }).click();
        await expect(page.getByText('This feature is only available for the United States.', { exact: false })).toBeVisible();
        assert.ok(requests.some(url => url.includes('ClockDropdown-')));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      results.push({ theme, width, timing }); console.log(`PASS: production ${theme} ${width}px`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('production-browser.json', output), JSON.stringify({ results, errors, environment: 'Local production build; actual entry, auth restore, task hook and Axios adapter; synthetic HTTP responses; external media blocked' }, null, 2) + '\n');
} finally { await browser.close(); }
