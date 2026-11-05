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
        assert.ok(measurements.desktop.p95Ms < 34 && measurements.mobileCpu4x.p95Ms < 34, 'Sampled frame timing exceeds two 60Hz frames');
        assert.equal(measurements.desktop.longTasks + measurements.mobileCpu4x.longTasks, 0);
        results.push('PASS: sampled desktop/4x-CPU mobile p95 frame interval <34ms, no long tasks');
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
        const alignment = await page.locator('.login-energy-border').evaluate(svg => {
            const core = svg.querySelector('.login-border-core');
            const runner = svg.querySelector('.login-border-runner:not(.login-border-halo)');
            const tail = svg.querySelector('.login-border-tail');
            for (const rect of [core, runner, tail]) rect.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 3000; });
            return { head: parseFloat(getComputedStyle(core).strokeDashoffset), runner: parseFloat(getComputedStyle(runner).strokeDashoffset), tail: parseFloat(getComputedStyle(tail).strokeDashoffset) };
        });
        assert.equal(alignment.runner - alignment.head, 45);
        assert.equal(alignment.tail - alignment.head, 155);
        results.push('PASS: exact border centerline/radius at three sizes; all sampled points stay on the perimeter');

        const smokeLoop = await page.locator('.login-smoke-left').evaluate(element => {
            const animation = element.getAnimations()[0];
            const { duration, delay } = animation.effect.getTiming();
            const samples = [0.001, .5, .999].map(phase => {
                animation.pause(); animation.currentTime = delay + phase * duration;
                return Number(getComputedStyle(element).opacity);
            });
            animation.play();
            return { samples, mask: getComputedStyle(element).maskImage, filter: getComputedStyle(element).filter };
        });
        assert.ok(smokeLoop.samples[0] < .01 && smokeLoop.samples[2] < .01 && smokeLoop.samples[1] > .3);
        assert.ok(smokeLoop.mask.includes('radial-gradient'));
        assert.equal(smokeLoop.filter, 'none');
        measurements.smokeLoop = smokeLoop;
        results.push('PASS: smoke fades to transparency at the cycle seam; feathered mask without blur filter');

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

        // Measure foreground contrast against the actual composited PNG, with glyphs hidden.
        // This includes transparency, supplied artwork, scanlines and the glass reflection.
        measurements.contrast = [];
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            const regions = await page.evaluate(() => {
                const selectors = ['.login-eyebrow', '#login-title', '#login-title span', '.login-welcome', 'label[for="email-address"]',
                    'label[for="password"]', '.login-forgot', '.login-card-signoff', '.login-submit > span:not([aria-hidden])'];
                const regions = selectors.map(selector => {
                    const element = document.querySelector(selector);
                    const box = element.getBoundingClientRect();
                    return { name: selector, color: getComputedStyle(element).color, x: box.x, y: box.y, width: box.width, height: box.height };
                });
                for (const selector of ['#email-address', '#password']) {
                    const element = document.querySelector(selector);
                    const box = element.getBoundingClientRect();
                    for (const placeholder of [false, true]) regions.push({ name: selector + (placeholder ? ' placeholder' : ' text'),
                        color: getComputedStyle(element, placeholder ? '::placeholder' : null).color,
                        x: box.x + 46, y: box.y + 18, width: box.width - 100, height: 18 });
                }
                return regions;
            });
            const hiddenGlyphs = await page.addStyleTag({ content: '.login-panel :is(h1, h1 span, p, label, input, .login-forgot, .login-submit > span:not([aria-hidden])) { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } .login-panel input::placeholder { color: transparent !important; } .login-eyebrow svg { visibility: hidden; }' });
            for (const [index, time] of [500, 10500, 20500].entries()) {
                await page.locator('.login-scene').evaluateAll((images, time) => images.forEach(image => image.getAnimations().forEach(animation => {
                    animation.pause(); animation.currentTime = time;
                })), time);
                await page.locator('.login-console-surface').evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => {
                    if (animation.animationName === 'login-glass-reflection') { animation.pause(); animation.currentTime = 7000; }
                }));
                const png = await page.screenshot();
                const ratios = await page.evaluate(async ({ encoded, regions }) => {
                    const image = new Image();
                    image.src = 'data:image/png;base64,' + encoded;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width; canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    const luminance = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
                        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
                    return regions.map(region => {
                        const foreground = luminance(region.color.match(/[\d.]+/g).slice(0, 3).map(Number));
                        const { data } = ctx.getImageData(Math.ceil(region.x), Math.ceil(region.y), Math.floor(region.width) - 1, Math.floor(region.height) - 1);
                        let minimum = Infinity;
                        for (let i = 0; i < data.length; i += 4) {
                            const background = luminance([data[i], data[i + 1], data[i + 2]]);
                            minimum = Math.min(minimum, (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05));
                        }
                        return { name: region.name, minimumRatio: minimum };
                    });
                }, { encoded: png.toString('base64'), regions });
                assert.ok(ratios.every(region => region.minimumRatio >= 4.5), JSON.stringify({ viewport, scene: index + 1, ratios }));
                measurements.contrast.push({ viewport, scene: index + 1, ratios });
            }
            await hiddenGlyphs.evaluate(element => element.remove());
            await page.screenshot({ path: fileURLToPath(new URL(`glass-${viewport.width}.png`, output)), fullPage: true });
        }
        results.push('PASS: sampled essential text/input/placeholder contrast >=4.5:1 on all three scenes at desktop/mobile sizes');
        await page.setViewportSize({ width: 1440, height: 900 });

        await page.evaluate(() => {
            window.__ambientMutations = 0;
            window.__ambientObserver = new MutationObserver(records => { window.__ambientMutations += records.length; });
            for (const selector of ['.login-environment', '.login-console-effects']) window.__ambientObserver.observe(document.querySelector(selector), { subtree: true, attributes: true, childList: true });
        });
        await page.locator('#email-address').pressSequentially('synthetic@example.com');
        await page.locator('#password').pressSequentially('synthetic-password');
        assert.equal(await page.evaluate(() => { window.__ambientObserver.disconnect(); return window.__ambientMutations; }), 0);
        results.push('PASS: typing does not mutate the memoized background/effect DOM');

        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(page.locator('.zeaplay-login')).toHaveAttribute('data-page-hidden', 'true');
        assert.equal(await page.locator('.login-border-core').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await expect(page.locator('.zeaplay-login')).toHaveAttribute('data-page-hidden', 'false');
        results.push('PASS: visibility listener pauses hidden-page effects and restores the visible state');

        // A preference change must also cancel a ripple that is already in flight.
        await page.locator('#email-address').fill('');
        await page.locator('#password').fill('');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect.poll(() => page.locator('.login-button-ripple').evaluate(el => el.getAnimations().length)).toBeGreaterThan(0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('.login-button-ripple').evaluate(el => el.getAnimations().length), 0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        results.push('PASS: system reduced-motion change cancels an in-flight CSS ripple');

        // Exercise mounts in the same JS session, then compare memory after forced GC.
        await cdp.send('HeapProfiler.collectGarbage');
        const beforeCycles = await metrics();
        measurements.mountCycles = { beforeHeapMiB: beforeCycles.JSHeapUsedSize / 1048576, batches: [] };
        for (let batch = 1; batch <= 2; batch++) {
            for (let i = 0; i < 8; i++) {
                await page.evaluate(() => { location.hash = '/reset-password'; });
                await page.locator('.zeaplay-login').waitFor({ state: 'detached' });
                await page.evaluate(() => { location.hash = '/login'; });
                await page.getByRole('heading', { name: 'Zea.Play', exact: true }).waitFor();
                await expect(page.locator('.login-environment')).toHaveAttribute('data-ready', 'true');
            }
            await frames(page, 700);
            await cdp.send('HeapProfiler.collectGarbage');
            const afterCycles = await metrics();
            measurements.mountCycles.batches.push({ mounts: batch * 8, heapMiB: afterCycles.JSHeapUsedSize / 1048576,
                listeners: afterCycles.JSEventListeners, nodes: afterCycles.Nodes });
        }
        const [first, second] = measurements.mountCycles.batches;
        assert.equal(second.listeners, first.listeners, 'Listeners stabilize after route warmup');
        assert.ok(second.heapMiB - first.heapMiB < 1, 'Post-GC JS heap must stabilize across repeated mounts');
        assert.equal(await page.locator('.login-environment').count(), 1);
        assert.equal(await page.locator('.login-console-effects').count(), 1);
        results.push('PASS: sixteen SPA mount cycles; listener count stable and second-batch post-GC heap growth <1MiB');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'Animation disabled by system preference' }).waitFor();
        assert.equal(await page.locator('.zeaplay-login').evaluate(el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);
        results.push('PASS: reduced motion leaves no running descendant animations');
        const reducedContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
        const reducedPage = await reducedContext.newPage();
        const requestedScenes = [];
        await reducedPage.route('**/*', route => {
            const url = new URL(route.request().url());
            if (route.request().resourceType() === 'image' && /\/login[123](?:-[^/]+)?\.png$/.test(url.pathname)) requestedScenes.push(url.pathname);
            if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = {};' });
            if (url.pathname.includes('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
            return route.continue();
        });
        await reducedPage.goto(base + '/#/login', { waitUntil: 'networkidle' });
        await expect(reducedPage.locator('.login-environment')).toHaveAttribute('data-ready', 'true');
        assert.equal(requestedScenes.length, 1);
        assert.ok(requestedScenes[0].includes('login3'));
        assert.equal(await reducedPage.locator('.login-scene').nth(1).getAttribute('src'), null);
        await reducedPage.emulateMedia({ reducedMotion: 'no-preference' });
        await expect.poll(() => reducedPage.locator('.login-scene').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 1000))).toBe(true);
        assert.equal(requestedScenes.length, 3);
        await reducedContext.close();
        results.push('PASS: initial reduced motion fetches only the static scene; enabling motion loads the other two');
        assert.deepEqual(errors, []);
    }
    await writeFile(new URL(baseline ? 'performance-before.json' : 'quality-results.json', output), JSON.stringify({ results, measurements,
        scope: 'Headless Chrome on this Windows host; emulated viewport/CPU, not physical mobile hardware. APIs/CDNs intercepted. Heap is JS-only; not GPU/process memory.' }, null, 2));
    console.log(JSON.stringify({ results, measurements }, null, 2));
    await context.close();
} finally { await browser.close(); }
