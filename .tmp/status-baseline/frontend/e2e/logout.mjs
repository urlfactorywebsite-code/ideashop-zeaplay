import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const base = process.env.ZEAPLAY_PASSWORD_TEST_URL || 'http://127.0.0.1:6302';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Loopback only');
const { chromium, expect } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    const pending = [];
    let refreshes = 0;
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/api/auth/logout')) { pending.push(route); return; }
        if (url.pathname.endsWith('/api/auth/refresh')) refreshes++;
        if (url.pathname.includes('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        return route.continue();
    });
    await page.goto(base + '/#/login');
    await page.getByRole('button', { name: 'Forgot your password?', exact: true }).waitFor();
    await page.evaluate(async () => {
        window.logoutErrors = [];
        window.addEventListener('unhandledrejection', event => window.logoutErrors.push(String(event.reason)));
        const { default: api } = await import('/services/mockApi.ts');
        api.logout();
    });
    assert.equal(pending.length, 0, 'No unauthenticated logout request');
    for (const status of [204, 401, 500, 'network']) {
        const request = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/api/auth/logout'));
        const cleared = await page.evaluate(async () => {
            const { default: api } = await import('/services/mockApi.ts');
            localStorage.setItem('vee_access_token', 'synthetic-access');
            localStorage.setItem('vee_refresh_token', 'synthetic-refresh');
            api.logout();
            return !localStorage.getItem('vee_access_token') && !localStorage.getItem('vee_refresh_token');
        });
        assert.ok(cleared, 'Local logout completes synchronously');
        const sent = await request;
        assert.equal(sent.headers().authorization, 'Bearer synthetic-access');
        await expect.poll(() => pending.length).toBe(1);
        await page.evaluate(() => localStorage.setItem('vee_access_token', 'synthetic-new-session'));
        const route = pending.shift();
        if (status === 'network') await route.abort();
        else await route.fulfill(status === 204 ? { status } : { status, contentType: 'application/json', body: '{"detail":"Synthetic failure"}' });
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => localStorage.getItem('vee_access_token')), 'synthetic-new-session');
        assert.deepEqual(await page.evaluate(() => window.logoutErrors), []);
        assert.equal(refreshes, 0, 'Logout never refreshes credentials or affects a newer session');
    }
    console.log('PASS: no-token logout, captured auth header, immediate cleanup, 204/401/500/network failures, no unhandled rejection, no refresh or newer-session deletion.');
    console.log('5 logout browser scenarios passed; all APIs intercepted; no real accounts or tokens used.');
} finally {
    await browser.close();
}
