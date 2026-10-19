import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_LOGIN_TEST_URL || 'http://127.0.0.1:6302';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const baseline = process.argv.includes('--baseline');
const output = new URL('../../docs/login-refinement/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const measurements = {};

async function frames(page, duration = 3600) {
    return page.evaluate(duration => new Promise(resolve => {
        const deltas = [];
        let last = 0;
        let start = 0;
        let longTasks = 0;
        const observer = new PerformanceObserver(list => { longTasks += list.getEntries().length; });
        observer.observe({ type: 'longtask', buffered: false });
        const sample = now => {
            if (!start) start = now;
            if (last) deltas.push(now - last);
            last = now;
            if (now - start < duration) requestAnimationFrame(sample);
            else {
                observer.disconnect();
                deltas.sort((a, b) => a - b);
                resolve({ frames: deltas.length, medianMs: deltas[Math.floor(deltas.length * .5)], p95Ms: deltas[Math.floor(deltas.length * .95)],
                    gapsOver34ms: deltas.filter(value => value > 34).length, longTasks });
            }
        };
        requestAnimationFrame(sample);
    }), duration);
}

try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = {};' });
        if (url.pathname.includes('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        return route.continue();
    });
    await page.goto(base + '/#/login', { waitUntil: 'networkidle' });
    await expect(page.locator('.login-environment')).toHaveAttribute('data-ready', 'true');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    for (const [name, viewport, rate] of [['desktop', { width: 1440, height: 900 }, 1], ['mobileCpu4x', { width: 390, height: 844 }, 4]]) {
        await page.setViewportSize(viewport);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        await frames(page, 400);
        await cdp.send('HeapProfiler.collectGarbage');
        const before = await metrics();
        const frameStats = await frames(page);
        const after = await metrics();
        measurements[name] = { ...frameStats, heapMiB: after.JSHeapUsedSize / 1048576,
            taskSeconds: after.TaskDuration - before.TaskDuration, layouts: after.LayoutCount - before.LayoutCount,
            styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount,
            elements: await page.locator('.zeaplay-login *').count(), viewport, cpuSlowdown: rate };
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!baseline) {
        // Sample the actual responsive rounded rect, including corners and the cycle seam.
        const perimeter = [];
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
            await page.setViewportSize(viewport);
            const shape = await page.locator('.login-border-core').evaluate(rect => {
                const panel = document.querySelector('.login-panel').getBoundingClientRect();
                const svg = rect.ownerSVGElement.getBoundingClientRect();
                const box = rect.getBBox();
                const style = getComputedStyle(rect);
                const points = Array.from({ length: 160 }, (_, index) => {
                    const point = rect.getPointAtLength(rect.getTotalLength() * index / 160);
                    return { x: point.x + svg.x - panel.x, y: point.y + svg.y - panel.y };
                });
                return { panel: { width: panel.width, height: panel.height }, box: { x: box.x + svg.x - panel.x, y: box.y + svg.y - panel.y, width: box.width, height: box.height },
                    radius: Number.parseFloat(style.rx), points, pathTransform: style.transform };
            });
            assert.ok(Math.abs(shape.box.x - .5) < .1 && Math.abs(shape.box.y - .5) < .1, 'Path aligns with border centerline');
            assert.ok(Math.abs(shape.box.width - (shape.panel.width - 1)) < .1);
            assert.ok(Math.abs(shape.box.height - (shape.panel.height - 1)) < .1);
            assert.equal(shape.radius, 21.5);
            assert.equal(shape.pathTransform, 'none');
            assert.ok(shape.points.every(point => Math.min(point.x, shape.panel.width - point.x, point.y, shape.panel.height - point.y) < 8));
            perimeter.push({ viewport, ...shape, points: undefined });
        }
        measurements.perimeter = perimeter;
        results.push('PASS: exact border centerline/radius at three sizes; all sampled points stay on the perimeter');

        await page.setViewportSize({ width: 1440, height: 900 });
        for (const time of [0, 1499, 3000, 4500, 5999, 6000]) {
            await page.locator('.login-energy-border rect').evaluateAll((rects, time) => rects.forEach(rect => rect.getAnimations().forEach(animation => {
                animation.pause(); animation.currentTime = time;
            })), time);
            await page.screenshot({ path: fileURLToPath(new URL(`border-${time}.png`, output)) });
        }
        const controls = await page.locator('.login-panel input, .login-panel button, .login-topbar button').evaluateAll(elements => elements.map(element => {
            const box = element.getBoundingClientRect();
            return { name: element.getAttribute('aria-label') || element.name || element.textContent.trim(), width: box.width, height: box.height };
        }));
        assert.ok(controls.every(control => control.width >= 44 && control.height >= 44));
        measurements.touchTargets = controls;
        assert.equal(await page.locator('.login-console-effects').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('.login-console-effects').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        results.push('PASS: every login control has a 44px target; effects hidden from accessibility tree and input events');

        await page.evaluate(() => {
            window.__ambientMutations = 0;
            window.__ambientObserver = new MutationObserver(records => { window.__ambientMutations += records.length; });
            for (const selector of ['.login-environment', '.login-console-effects']) window.__ambientObserver.observe(document.querySelector(selector), { subtree: true, attributes: true, childList: true });
        });
        await page.locator('#email-address').pressSequentially('synthetic@example.com');
        await page.locator('#password').pressSequentially('synthetic-password');
        assert.equal(await page.evaluate(() => { window.__ambientObserver.disconnect(); return window.__ambientMutations; }), 0);
        results.push('PASS: typing does not mutate the memoized background/effect DOM');

        // Exercise mounts in the same JS session, then compare memory after forced GC.
        await cdp.send('HeapProfiler.collectGarbage');
        const beforeCycles = await metrics();
        for (let i = 0; i < 8; i++) {
            await page.evaluate(() => { location.hash = '/reset-password'; });
            await page.locator('.zeaplay-login').waitFor({ state: 'detached' });
            await page.evaluate(() => { location.hash = '/login'; });
            await page.getByRole('heading', { name: 'Zea.Play', exact: true }).waitFor();
        }
        await cdp.send('HeapProfiler.collectGarbage');
        const afterCycles = await metrics();
        measurements.mountCycles = { count: 8, beforeHeapMiB: beforeCycles.JSHeapUsedSize / 1048576, afterHeapMiB: afterCycles.JSHeapUsedSize / 1048576,
            beforeListeners: beforeCycles.JSEventListeners, afterListeners: afterCycles.JSEventListeners, beforeNodes: beforeCycles.Nodes, afterNodes: afterCycles.Nodes };
        assert.equal(await page.locator('.login-environment').count(), 1);
        assert.equal(await page.locator('.login-console-effects').count(), 1);
        results.push('PASS: eight SPA unmount/remount cycles; heap/listener/node counts recorded after GC');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'Animation disabled by system preference' }).waitFor();
        assert.equal(await page.locator('.zeaplay-login').evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
        results.push('PASS: reduced motion leaves no running descendant animations');
        assert.deepEqual(errors, []);
    }
    await writeFile(new URL(baseline ? 'performance-before.json' : 'quality-results.json', output), JSON.stringify({ results, measurements,
        scope: 'Headless Chrome on this Windows host; emulated viewport/CPU, not physical mobile hardware. APIs/CDNs intercepted. Heap is JS-only; not GPU/process memory.' }, null, 2));
    console.log(JSON.stringify({ results, measurements }, null, 2));
    await context.close();
} finally { await browser.close(); }
