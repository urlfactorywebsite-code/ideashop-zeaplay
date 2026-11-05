// Production builds only. Loopback server, synthetic auth, extension-free Chrome.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const before = process.argv.includes('--before');
const root = path.resolve(fileURLToPath(new URL(before ? '../../.tmp/login-performance-before/' : '../dist/', import.meta.url)));
const output = new URL('../../docs/login-performance/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const graph = new Set();
function collect(key) {
  if (graph.has(key)) return;
  graph.add(key);
  for (const dependency of manifest[key].imports || []) collect(dependency);
}
collect('index.html');
const initialFiles = [...graph].map(key => manifest[key].file);
const sizes = await Promise.all(initialFiles.map(async file => {
  const bytes = await readFile(path.join(root, file));
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}));
let configDelay = 0;
const requests = [];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/runtime-config.js') {
      if (configDelay) await new Promise(resolve => setTimeout(resolve, configDelay));
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end('window.__RUNTIME_CONFIG__ = { API_URL: "/runtime-api" };');
    }
    if (url.pathname.startsWith('/runtime-api/') || url.pathname.startsWith('/api/')) {
      const recovery = url.pathname.endsWith('/auth/forgot-password');
      res.writeHead(recovery ? 202 : 401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(recovery ? { message: 'Accepted' } : { detail: 'Synthetic invalid credentials' }));
    }
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + path.sep) && filename !== path.join(root, 'index.html')) {
      res.writeHead(403); return res.end();
    }
    const body = await readFile(filename);
    const compress = /\.(?:js|css|html)$/.test(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': filename.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(compress ? gzipSync(body) : body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 15000 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const samples = [], errors = [], checks = [];
try {
  for (const [device, viewport, rate] of [['desktop', { width: 1440, height: 900 }, 1], ['mobile4x', { width: 390, height: 844 }, 4]]) {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        window.loginTiming = { lcp: null, longTasks: [] };
        new PerformanceObserver(list => {
          const item = list.getEntries().at(-1);
          window.loginTiming.lcp = { ms: item.startTime, element: item.element?.className || item.element?.tagName };
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => window.loginTiming.longTasks.push(...list.getEntries().map(item => ({ start: item.startTime, duration: item.duration }))))
          .observe({ type: 'longtask', buffered: true });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const cache of ['cold', 'warm']) {
        await page.goto(base + `/?run=${run}&cache=${cache}#/login`, { waitUntil: 'load' });
        await expect(page.locator('.login-wordmark')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.loginTiming.lcp?.ms || 0)).toBeGreaterThan(0);
        await page.waitForTimeout(300);
        const result = await page.evaluate(() => ({ ...window.loginTiming,
          domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
          resources: performance.getEntriesByType('resource').filter(item => /\.(?:js|css)(?:$|\?)/.test(item.name))
            .map(item => ({ file: new URL(item.name).pathname, transferSize: item.transferSize, decodedBytes: item.decodedBodySize })) }));
        assert.ok(result.lcp?.ms > 0, JSON.stringify({ device, run, cache, result }));
        samples.push({ device, rate, run, cache, ...result });
        if (!before) {
          const loaded = new Set(result.resources.map(item => item.file));
          for (const name of ['Layout', 'ForgotPasswordModal', 'PasswordReset']) {
            const entry = Object.values(manifest).find(item => item.name === name);
            assert.ok(entry?.isDynamicEntry, `${name} must have a lazy entry`);
            assert.ok(!loaded.has('/' + entry.file), `${name} must not load on login`);
          }
        }
      }
      if (!before && run === 0) {
        await page.screenshot({ path: fileURLToPath(new URL(`login-${device}.png`, output)), fullPage: true });
      }
      await context.close();
    }
  }
  assert.ok(!requests.some(url => url.startsWith('/api/')), 'API initialization must read the runtime URL');
  checks.push('Cold and warm production login renders on desktop and 4x CPU mobile; runtime API URL respected');
  if (!before) {
    configDelay = 300;
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/login');
    await expect(page.locator('.login-wordmark')).toBeVisible();
    await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#forgot-email').fill('synthetic@example.test');
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'emailed shortly' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Forgot your password?', exact: true })).toBeFocused();
    await page.locator('#email-address').fill('synthetic@example.test');
    await page.locator('#password').fill('synthetic-invalid');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Synthetic invalid credentials');
    await page.goto(base + '/#/reset-password');
    await expect(page.getByRole('heading', { name: /password/i })).toBeVisible();
    assert.ok(!requests.some(url => url.startsWith('/api/')), 'Delayed config must still precede API module initialization');
    checks.push('Lazy recovery opens, submits, closes and restores focus; invalid login and direct reset route work; delayed runtime config wins');
    await context.close();
  }
  assert.deepEqual(errors, []);
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = {};
  for (const device of ['desktop', 'mobile4x']) for (const cache of ['cold', 'warm']) {
    const matching = samples.filter(item => item.device === device && item.cache === cache);
    summary[device + '-' + cache] = { medianLcpMs: median(matching.map(item => item.lcp.ms)),
      medianLongTaskMs: median(matching.map(item => item.longTasks.reduce((sum, task) => sum + task.duration, 0))),
      medianJsTransferBytes: median(matching.map(item => item.resources.filter(resource => resource.file.endsWith('.js')).reduce((sum, resource) => sum + resource.transferSize, 0))) };
  }
  const report = { environment: 'Loopback gzip static server; production Vite build; synthetic anonymous auth; extension-free Chrome; 3 cold/warm pairs per viewport; no network throttling; reduced motion',
    initialJsBytes: sizes.reduce((sum, item) => sum + item.bytes, 0), initialJsGzipBytes: sizes.reduce((sum, item) => sum + item.gzipBytes, 0),
    sizes, summary, checks, samples, errors };
  await writeFile(new URL(before ? 'before.json' : 'after.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ initialJsBytes: report.initialJsBytes, initialJsGzipBytes: report.initialJsGzipBytes, summary, checks }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
