import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const base = process.env.ZEAPLAY_LOGIN_TEST_URL || 'http://127.0.0.1:6302';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const { chromium, expect } = await import(pathToFileURL(modulePath).href);
const output = new URL(process.env.ZEAPLAY_LOGIN_CHECKS_PATH || '../../docs/login-phase2/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const syntheticUser = { id: 'login-ui-only', name: 'Synthetic Player', email: 'synthetic@example.com', role: 'user', status: 'active', tenant_id: '00000000-0000-0000-0000-000000000001', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
        const OriginalAudioContext = window.AudioContext;
        window.__loginAudio = { contexts: 0, oscillators: 0, closes: 0, frequencies: [] };
        window.AudioContext = class extends OriginalAudioContext {
            constructor(...args) { super(...args); window.__loginAudio.contexts++; }
            createOscillator() {
                const oscillator = super.createOscillator();
                const start = oscillator.start.bind(oscillator);
                oscillator.start = (...args) => {
                    window.__loginAudio.oscillators++;
                    window.__loginAudio.frequencies.push(oscillator.frequency.value);
                    return start(...args);
                };
                return oscillator;
            }
            close() { window.__loginAudio.closes++; return super.close(); }
        };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let loginRoute;
    const submissions = [];
    const recoveries = [];
    let holdScenes = true;
    const delayedScenes = [];
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        // The legacy HTML expects this global. Supply no Tailwind styles or network script.
        if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = {};' });
        if (holdScenes && route.request().resourceType() === 'image' && /\/login[12]\.png$/.test(url.pathname)) { delayedScenes.push(route); return; }
        if (url.pathname.endsWith('/api/auth/login')) { submissions.push(route.request().postDataJSON()); loginRoute = route; return; }
        if (url.pathname.endsWith('/api/auth/forgot-password')) {
            recoveries.push(route.request().postDataJSON());
            return route.fulfill({ status: 202, contentType: 'application/json', body: '{"message":"Accepted"}' });
        }
        if (url.pathname.endsWith('/api/auth/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticUser) });
        if (url.pathname.includes('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        // External CDNs are blocked deliberately: the new screen must style itself.
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        return route.continue();
    });
    await page.goto(base + '/#/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Zea.Play', exact: true }).waitFor();
    await expect.poll(() => delayedScenes.length).toBe(2);
    await expect.poll(() => page.locator('.login-scene').first().evaluate(image => image.complete && image.naturalWidth > 1000)).toBe(true);
    assert.equal(await page.locator('.login-environment').getAttribute('data-ready'), 'false');
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).opacity), '1');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    holdScenes = false;
    for (const route of delayedScenes) await route.continue();
    await expect(page.locator('.login-environment')).toHaveAttribute('data-ready', 'true');
    results.push('PASS: slow scene loading keeps the first background static and the login usable');
    await expect.poll(() => page.locator('.login-scene').evaluateAll(images => images.every(image => image.complete && image.naturalWidth >= 1000))).toBe(true);
    assert.equal(await page.locator('.login-scene').count(), 3);
    assert.equal(await page.locator('canvas').count(), 0);
    results.push('PASS: all three provided images render; no WebGL canvas or external CSS dependency');

    const motion = page.getByRole('button', { name: 'Pause background animation', exact: true });
    await motion.click();
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
    await page.getByRole('button', { name: 'Play background animation', exact: true }).click();
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).animationPlayState), 'running');
    const before = await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).transform);
    await expect.poll(() => page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).transform)).not.toBe(before);
    results.push('PASS: background moves and the pause/play control works');

    const runner = page.locator('.login-border-runner:not(.login-border-halo)');
    const geometry = await runner.evaluate(element => {
        const bounds = element.getBBox();
        const panel = document.querySelector('.login-panel').getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, panelWidth: panel.width, panelHeight: panel.height,
            duration: getComputedStyle(element).animationDuration, stroke: getComputedStyle(element).stroke };
    });
    assert.ok(Math.abs(geometry.width - geometry.panelWidth) < 3 && Math.abs(geometry.height - geometry.panelHeight) < 3);
    assert.equal(geometry.duration, '6s');
    const offset = await runner.evaluate(element => getComputedStyle(element).strokeDashoffset);
    await expect.poll(() => runner.evaluate(element => getComputedStyle(element).strokeDashoffset)).not.toBe(offset);
    const smoke = page.locator('.login-smoke-left');
    const smokeTransform = await smoke.evaluate(element => getComputedStyle(element).transform);
    await expect.poll(() => smoke.evaluate(element => getComputedStyle(element).transform)).not.toBe(smokeTransform);
    await page.getByRole('button', { name: 'Pause background animation', exact: true }).click();
    assert.equal(await runner.evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
    assert.equal(await smoke.evaluate(element => getComputedStyle(element).animationPlayState), 'paused');
    await page.getByRole('button', { name: 'Play background animation', exact: true }).click();
    results.push('PASS: rounded border follows responsive perimeter in six seconds; neon/smoke animate and pause');

    // Capture four perimeter positions at the same scene/time for visual review.
    for (const [index, time] of [0, 1500, 3000, 4500].entries()) {
        await page.locator('.login-energy-border rect').evaluateAll((rects, timestamp) => rects.forEach(rect => rect.getAnimations().forEach(animation => {
            animation.pause(); animation.currentTime = timestamp;
        })), time);
        await page.screenshot({ path: fileURLToPath(new URL(`energy-border-${index + 1}.png`, output)) });
    }
    await page.locator('.login-energy-border rect').evaluateAll(rects => rects.forEach(rect => rect.getAnimations().forEach(animation => animation.play())));

    for (const [index, timestamp] of [500, 10500, 20500].entries()) {
        await page.locator('.login-scene').evaluateAll((images, time) => images.forEach(image => image.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; })), timestamp);
        await page.locator('.login-scene').evaluateAll(async images => {
            for (const image of images) await image.decode();
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
        });
        const opacities = await page.locator('.login-scene').evaluateAll(images => images.map(image => Number(getComputedStyle(image).opacity)));
        assert.ok(opacities[index] > .99 && opacities.filter(value => value > .99).length === 1);
        const screenshot = await page.screenshot({ path: fileURLToPath(new URL(`desktop-scene-${index + 1}.png`, output)) });
        const goldPixels = await page.evaluate(async encoded => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + encoded;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, Math.floor(image.height * .2), Math.floor(image.width * .3), Math.floor(image.height * .55));
            let count = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] > 130 && data[i + 1] > 75 && data[i + 2] < data[i] / 2) count++;
            return count;
        }, screenshot.toString('base64'));
        assert.ok(goldPixels > 1000, `Scene ${index + 1} must actually paint the mascot, not just report opacity: ${goldPixels}`);
    }
    await page.locator('.login-scene').evaluateAll(images => images.forEach(image => image.getAnimations().forEach(animation => { animation.currentTime = 9000; })));
    const fade = await page.locator('.login-scene').evaluateAll(images => images.map(image => Number(getComputedStyle(image).opacity)));
    assert.equal(fade.filter(value => value > .1 && value < .9).length, 2);
    results.push('PASS: each scene becomes visible and adjacent scenes crossfade without a blank interval');
    await page.locator('.login-scene').evaluateAll(images => images.forEach(image => image.getAnimations().forEach(animation => { animation.currentTime = 500; })));

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        const bounds = await page.evaluate(() => {
            const panel = document.querySelector('.login-panel').getBoundingClientRect();
            const inputs = [...document.querySelectorAll('.login-panel input, .login-submit')].map(element => element.getBoundingClientRect());
            return { overflow: document.documentElement.scrollWidth > innerWidth, panelFits: panel.left >= 0 && panel.right <= innerWidth,
                controlsFit: inputs.every(rect => rect.left >= panel.left && rect.right <= panel.right) };
        });
        assert.deepEqual(bounds, { overflow: false, panelFits: true, controlsFit: true }, JSON.stringify(viewport));
        await page.screenshot({ path: fileURLToPath(new URL(`viewport-${viewport.width}x${viewport.height}.png`, output)), fullPage: true });
    }
    results.push('PASS: six desktop/tablet/mobile/short-landscape viewports without horizontal overflow or clipped controls');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#email-address').focus();
    const focusStyle = await page.locator('#email-address').evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, color: getComputedStyle(element).color }));
    assert.equal(focusStyle.outline, 'solid');
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });
    const buttonBase = await submit.evaluate(element => element.getBoundingClientRect().y);
    await submit.hover();
    await expect.poll(() => submit.evaluate(element => element.getBoundingClientRect().y)).toBeLessThan(buttonBase - 1);
    const buttonBounds = await submit.boundingBox();
    await page.mouse.move(buttonBounds.x + buttonBounds.width / 2, buttonBounds.y + buttonBounds.height / 2);
    await page.mouse.down();
    await expect.poll(() => submit.evaluate(element => element.getBoundingClientRect().y)).toBeGreaterThan(buttonBase + 2);
    await page.mouse.up();
    await expect.poll(() => page.locator('.login-button-ripple').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
    assert.equal(await page.evaluate(() => window.__loginAudio.contexts), 0);
    await page.getByRole('button', { name: 'Enable interaction sound', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute interaction sound', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.evaluate(() => window.__loginAudio.contexts), 1);
    await submit.click();
    await expect.poll(() => page.evaluate(() => window.__loginAudio.oscillators)).toBe(2);
    await page.getByRole('button', { name: 'Mute interaction sound', exact: true }).click();
    await submit.click();
    assert.equal(await page.evaluate(() => window.__loginAudio.oscillators), 2);
    results.push('PASS: physical hover/press/ripple and real Web Audio opt-in/mute; no autoplay context');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    assert.equal(submissions.length, 0);
    await page.locator('#email-address').fill('not-an-email');
    await page.locator('#password').fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    assert.equal(submissions.length, 0);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.locator('#password').getAttribute('type'), 'text');
    assert.equal(await page.locator('#password').inputValue(), 'synthetic-password');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toHaveAttribute('aria-pressed', 'false');
    assert.equal(await page.locator('#password').getAttribute('type'), 'password');
    await page.locator('#email-address').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Forgot your password?', exact: true })).toBeFocused();
    results.push('PASS: native required/email validation, password visibility and keyboard focus');

    await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.locator('#forgot-email').fill('synthetic@example.com');
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'emailed shortly' }).waitFor();
    assert.deepEqual(recoveries, [{ email: 'synthetic@example.com' }]);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await expect(page.getByRole('button', { name: 'Forgot your password?', exact: true })).toBeFocused();
    results.push('PASS: existing recovery modal/API contract, Escape and focus restoration');

    await page.locator('#email-address').fill('synthetic@example.com');
    await page.getByRole('button', { name: 'Enable interaction sound', exact: true }).click();
    await page.locator('#password').press('Enter');
    await expect.poll(() => !!loginRoute).toBe(true);
    await expect(page.getByRole('button', { name: 'Signing in...', exact: true })).toBeDisabled();
    assert.deepEqual(submissions[0], { email: 'synthetic@example.com', password: 'synthetic-password' });
    await page.locator('#password').press('Enter');
    await page.evaluate(() => document.querySelector('.login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(submissions.length, 1);
    await loginRoute.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Invalid email or password"}' });
    await page.getByRole('alert').filter({ hasText: 'Invalid email or password' }).waitFor();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    assert.equal(await page.locator('#email-address').inputValue(), 'synthetic@example.com');
    await expect.poll(() => page.evaluate(() => window.__loginAudio.oscillators)).toBe(6);
    results.push('PASS: keyboard login, unchanged payload, duplicate-submit guard, pending state and backend error with audio cue');

    await page.evaluate(() => history.replaceState({ ...history.state, usr: { from: { pathname: '/reset-password' } } }, ''));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#email-address').fill('synthetic@example.com');
    await page.locator('#password').fill('synthetic-password');
    await page.getByRole('button', { name: 'Enable interaction sound', exact: true }).click();
    loginRoute = null;
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect.poll(() => !!loginRoute).toBe(true);
    await loginRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: syntheticUser, token: { access_token: 'synthetic-access-ui-only', refresh_token: 'synthetic-refresh-ui-only', token_type: 'bearer' } }) });
    await page.waitForURL('**/#/reset-password');
    await expect.poll(() => page.evaluate(() => window.__loginAudio.oscillators)).toBe(5);
    await expect.poll(() => page.evaluate(() => window.__loginAudio.closes)).toBe(1);
    assert.deepEqual(await page.evaluate(async () => {
        const tokens = await import('/services/tokenStorage.ts');
        return [tokens.getAccessToken(), tokens.getRefreshToken()];
    }), ['synthetic-access-ui-only', 'synthetic-refresh-ui-only']);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('vee_access_token'), localStorage.getItem('vee_refresh_token')]), [null, null]);
    results.push('PASS: existing successful-login session/redirect; success cue followed by audio resource cleanup');

    await page.evaluate(async () => { (await import('/services/tokenStorage.ts')).clearTokens(); });
    await page.goto(base + '/#/login');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByRole('button', { name: 'Animation disabled by system preference' })).toBeDisabled();
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.locator('.login-scene').first().evaluate(element => getComputedStyle(element).opacity), '1');
    assert.equal(await page.locator('.login-scene').nth(1).evaluate(element => getComputedStyle(element).opacity), '0');
    assert.equal(await runner.evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await smoke.evaluate(element => getComputedStyle(element).display), 'none');
    assert.equal(await page.locator('.login-button-bubbles i').first().evaluate(element => getComputedStyle(element).animationName), 'none');
    await submit.click();
    assert.equal(await page.locator('.login-button-ripple').evaluate(element => element.getAnimations().length), 0);
    for (const theme of ['light', 'dark', 'colorful']) {
        await page.evaluate(value => { localStorage.setItem('zenith-task-theme', value); }, theme);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Zea.Play', exact: true }).waitFor();
        assert.equal(await page.locator('.login-submit').evaluate(element => getComputedStyle(element).color), 'rgb(6, 45, 42)');
    }
    await page.screenshot({ path: fileURLToPath(new URL('reduced-motion.png', output)) });
    results.push('PASS: live reduced-motion preference and stable readable design under all existing theme settings');
    assert.deepEqual(errors, []);
    results.push('PASS: no uncaught page errors');
    await context.close();
} finally {
    await browser.close();
}
await writeFile(new URL('browser-results.json', output), JSON.stringify({ results, safety: 'Loopback only; API/CDN traffic intercepted; no real credentials or emails.' }, null, 2));
for (const result of results) console.log(result);
console.log(`${results.length} login UI browser checks passed.`);
