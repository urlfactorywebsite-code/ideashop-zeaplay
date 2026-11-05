// Production startup on loopback, synthetic session/chat data, no real messages.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { navigationDocument } from './navigation-fixture.mjs';

const before = process.argv.includes('--before');
const root = path.resolve(fileURLToPath(new URL(before ? '../../.tmp/chat-performance-before/' : '../dist/', import.meta.url)));
const output = new URL('../../docs/chat-performance/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const graph = new Set();
function collect(key) {
  if (graph.has(key)) return;
  graph.add(key);
  for (const dependency of manifest[key].imports || []) collect(dependency);
}
for (const [key, entry] of Object.entries(manifest)) if (['index', 'Layout', 'Chat'].includes(entry.name)) collect(key);
const sizes = await Promise.all([...graph].map(async key => {
  const bytes = await readFile(path.join(root, manifest[key].file));
  return { file: manifest[key].file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}));
const now = '2026-10-23T06:00:00Z';
const user = { id: 'chat-performance-owner', tenant_id: 'synthetic-chat-performance', name: 'Chat Reviewer',
  email: 'reviewer@example.test', role: 'owner', status: 'ACTIVE' };
const member = { user_id: user.id, name: user.name, email: user.email, role: 'OWNER', app_role: 'owner',
  joined_at: now, is_muted: false, is_pinned: false };
const conversation = { id: 'conversation-fixture', tenant_id: user.tenant_id, type: 'GROUP', name: 'Performance room',
  members: [member], is_private: true, is_archived: false, unread_count: 0, created_at: now, updated_at: now };
const messages = [{ id: 'message-fixture', conversation_id: conversation.id, sender_id: user.id,
  sender_name: user.name, content: 'Existing synthetic message', created_at: now, updated_at: now,
  attachments: [], reactions: [], type: 'TEXT' }];
const requests = [], sent = [];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/runtime-config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(`window.__RUNTIME_CONFIG__={API_URL:'/api',PRESENCE_URL:'http://${req.headers.host}',WS_URL:'http://${req.headers.host}/api'};`);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
      let data = [];
      if (url.pathname.endsWith('/auth/browser-session/refresh')) data = { access_token: 'synthetic-chat-session', refresh_token: 'synthetic-refresh' };
      else if (url.pathname.endsWith('/auth/me')) data = user;
      else if (url.pathname === '/api/navigation') data = navigationDocument('owner');
      else if (url.pathname === '/api/users') data = [user];
      else if (url.pathname.endsWith('/work/active')) data = { items: [], running_count: 0, limit: 5, server_time: now, user_id: user.id, tenant_id: user.tenant_id };
      else if (url.pathname.endsWith('/websocket-ticket') || url.pathname.endsWith('/presence-token')) data = { access_token: 'synthetic-socket-ticket' };
      else if (url.pathname === '/api/chat/conversations') data = [conversation];
      else if (url.pathname.endsWith('/chat/users')) data = { items: [], next_cursor: null };
      else if (url.pathname === `/api/chat/conversations/${conversation.id}`) data = { ...conversation, messages };
      else if (url.pathname.endsWith('/messages') && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body); sent.push(payload);
        data = { ...messages[0], id: 'sent-' + sent.length, content: payload.content, client_id: payload.client_id };
        messages.push(data);
      } else if (url.pathname.endsWith('/messages')) data = { items: messages, next_cursor: null, has_more: false };
      else if (url.pathname.endsWith('/read')) data = member;
      if (url.pathname.endsWith('/notifications/stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const body = await readFile(filename), compress = /\.(?:js|css|html)$/.test(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': filename.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(compress ? gzipSync(body) : body);
  } catch { res.writeHead(404); res.end(); }
});
server.on('upgrade', (_req, socket) => socket.destroy());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 15000 });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
const samples = [], errors = [], checks = [];
try {
  for (const [device, viewport, rate] of [['desktop', { width: 1440, height: 900 }, 1], ['mobile4x', { width: 390, height: 844 }, 4]]) {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        window.chatTiming = { lcp: null, cls: 0, longTasks: [] };
        new PerformanceObserver(list => { const item = list.getEntries().at(-1);
          window.chatTiming.lcp = { ms: item.startTime, element: item.element?.className || item.element?.tagName }; })
          .observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const item of list.getEntries()) if (!item.hadRecentInput) window.chatTiming.cls += item.value; })
          .observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver(list => window.chatTiming.longTasks.push(...list.getEntries().map(item => ({ start: item.startTime, duration: item.duration }))))
          .observe({ type: 'longtask', buffered: true });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const cache of ['cold', 'warm']) {
        await page.goto(base + `/?run=${run}&cache=${cache}#/chat`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByPlaceholder(/^Message #performance-room/)).toBeVisible();
        await expect(page.getByText('Existing synthetic message', { exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.chatTiming.lcp?.ms || 0)).toBeGreaterThan(0);
        await page.waitForTimeout(300);
        const result = await page.evaluate(() => ({ ...window.chatTiming,
          resources: performance.getEntriesByType('resource').filter(item => /\.(?:js|webp)(?:$|\?)/.test(item.name))
            .map(item => ({ file: new URL(item.name).pathname, transferSize: item.transferSize, decodedBytes: item.decodedBodySize, start: item.startTime, end: item.responseEnd })),
          header: (() => { const rect = document.querySelector('.zea-app-header').getBoundingClientRect(); return { height: rect.height, width: rect.width }; })() }));
        samples.push({ device, run, rate, cache, ...result });
        if (!before) {
          await expect(page.locator('.zea-header-poster')).toBeVisible();
          await expect(page.locator('.zea-header-video')).toHaveCount(0);
          const loaded = new Set(result.resources.map(item => item.file));
          for (const name of ['TaskDetailModal', 'ClockDropdown', 'TaskDocumentation']) {
            const entry = Object.values(manifest).find(item => item.name === name);
            assert.ok(entry?.isDynamicEntry, `${name} must be lazy`);
            assert.ok(!loaded.has('/' + entry.file), `${name} must stay unloaded during chat startup`);
          }
          if (run === 0 && cache === 'cold') await page.screenshot({ path: fileURLToPath(new URL(`chat-${device}.png`, output)), fullPage: true });
        }
      }
      await context.close();
    }
  }
  checks.push('12 cold/warm production chat loads, real App/auth/API mapping, existing messages and composer visible');
  if (!before) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/chat');
    await page.getByPlaceholder(/^Message #performance-room/).fill('Synthetic local chat verification');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Synthetic local chat verification', { exact: true }).first()).toBeVisible();
    assert.equal(sent.length, 1);
    await page.getByRole('button', { name: 'Open clock assistant', exact: true }).click();
    await expect(page.getByText('This feature is only available for the United States.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Open clock assistant', exact: true }).click();
    await expect(page.getByText('This feature is only available for the United States.', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open user manual', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close manual', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close manual', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.zea-header-video')).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.zea-header-video')).toHaveCount(0);
    await expect(page.locator('.zea-header-poster')).toBeVisible();
    checks.push('Synthetic message send, lazy clock open/close, lazy manual, live reduced-motion toggle and poster fallback');
    await context.close();
    const saving = await browser.newContext({ reducedMotion: 'no-preference' });
    await saving.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }));
    const savingPage = await saving.newPage();
    await savingPage.goto(base + '/#/chat');
    await expect(savingPage.locator('.zea-header-poster')).toBeVisible();
    await savingPage.waitForTimeout(1200);
    await expect(savingPage.locator('.zea-header-video')).toHaveCount(0);
    checks.push('Data saver keeps the static poster without loading decorative video');
    await saving.close();
  }
  assert.deepEqual(errors, []);
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = {};
  for (const device of ['desktop', 'mobile4x']) for (const cache of ['cold', 'warm']) {
    const matching = samples.filter(item => item.device === device && item.cache === cache);
    summary[device + '-' + cache] = { medianLcpMs: median(matching.map(item => item.lcp.ms)),
      medianLongTaskMs: median(matching.map(item => item.longTasks.reduce((sum, task) => sum + task.duration, 0))),
      maxCls: Math.max(...matching.map(item => item.cls)),
      medianJsTransferBytes: median(matching.map(item => item.resources.filter(resource => resource.file.endsWith('.js')).reduce((sum, resource) => sum + resource.transferSize, 0))) };
  }
  const report = { environment: 'Loopback gzip production build; synthetic authenticated API; extension-free Chrome; 3 cold/warm pairs per viewport; no network throttle; reduced motion; external DNS blocked; no live chat or video playback certification',
    routeJsBytes: sizes.reduce((sum, item) => sum + item.bytes, 0), routeJsGzipBytes: sizes.reduce((sum, item) => sum + item.gzipBytes, 0), sizes, summary, samples, checks, errors };
  await writeFile(new URL(before ? 'before.json' : 'after.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ routeJsBytes: report.routeJsBytes, routeJsGzipBytes: report.routeJsGzipBytes, summary, checks }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
