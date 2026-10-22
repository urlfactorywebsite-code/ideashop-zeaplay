import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const base = process.env.ZEAPLAY_CHUNK_TEST_URL || 'http://127.0.0.1:16300';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Only loopback test targets are allowed');
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const context = await browser.newContext();
    const shell = await context.request.get(base + '/');
    assert.equal(shell.status(), 200);
    assert.match(shell.headers()['cache-control'], /no-cache/);
    const deepLink = await context.request.get(base + '/settings');
    assert.equal(deepLink.status(), 200);
    assert.match(deepLink.headers()['cache-control'], /no-cache/);
    const missing = await context.request.get(base + '/assets/Settings-missing-build.js');
    assert.equal(missing.status(), 404);
    assert.match(missing.headers()['cache-control'], /no-store/);
    assert.equal(missing.headers()['x-content-type-options'], 'nosniff');
    assert.ok(!(await missing.text()).includes('<div id="root">'));
    const entryPath = (await shell.text()).match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
    const entry = await context.request.get(base + entryPath);
    assert.equal(entry.status(), 200);
    assert.match(entry.headers()['content-type'], /javascript/);
    assert.match(entry.headers()['cache-control'], /max-age=31536000/);
    console.log('PASS: shell and deep links revalidate, existing JS loads, missing chunks are uncached 404s');

    // A public lazy route exercises the same root error boundary as Settings
    // without needing real credentials or making changes to an account.
    const page = await context.newPage();
    let failChunk = true;
    let documentRequests = 0;
    let failedChunks = 0;
    page.on('request', request => { if (request.isNavigationRequest()) documentRequests++; });
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
        if (failChunk && /\/OAuthAuthorization-[^/]+\.js$/.test(url.pathname)) {
            failedChunks++;
            return route.abort('failed');
        }
        return route.continue();
    });
    await page.goto(base + '/#/oauth/authorize?state=recovery-check', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'This page couldn’t load', exact: true }).waitFor();
    assert.ok(failedChunks > 0);
    assert.equal(await page.getByText('Unexpected Application Error!', { exact: true }).count(), 0);
    assert.equal(documentRequests, 1);
    assert.match(await page.getByRole('alert').innerText(), /reconnect first/);
    await page.evaluate(() => localStorage.setItem('recovery-check', 'preserved'));
    // A continuing outage must remain recoverable without automatic reload loops.
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await page.getByRole('heading', { name: 'This page couldn’t load', exact: true }).waitFor();
    assert.equal(documentRequests, 2);
    failChunk = false;
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await page.getByRole('heading', { name: /Application authorization/ }).waitFor();
    assert.equal(documentRequests, 3);
    assert.equal(new URL(page.url()).hash, '#/oauth/authorize?state=recovery-check');
    assert.equal(await page.evaluate(() => localStorage.getItem('recovery-check')), 'preserved');
    console.log('PASS: failed lazy imports show recovery UI, persistent failures do not loop, reload recovers and preserves route/storage');
} finally {
    await browser.close();
}
