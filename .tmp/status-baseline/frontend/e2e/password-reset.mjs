import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const base = process.env.ZEAPLAY_PASSWORD_TEST_URL || 'http://127.0.0.1:6302';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Only loopback test targets are allowed');
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = new URL('../../docs/password-reset-checks/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    let forgotStatus = 503;
    let resetStatus = 400;
    const requests = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.includes('/api/')) {
            if (url.pathname.endsWith('/auth/forgot-password')) {
                requests.push({ kind: 'request', body: route.request().postDataJSON() });
                return route.fulfill({ status: forgotStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'Password recovery is not configured. Contact your administrator.' }) });
            }
            if (url.pathname.endsWith('/auth/reset-password')) {
                requests.push({ kind: 'redeem', body: route.request().postDataJSON() });
                return route.fulfill(resetStatus === 204 ? { status: 204 } : { status: resetStatus, contentType: 'application/json', body: JSON.stringify({ detail: 'This password reset link is invalid or expired. Request a new link.' }) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        return route.continue();
    });
    await page.goto(base + '/#/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click();
    await page.locator('#forgot-email').fill('synthetic@example.com');
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'not configured' }).waitFor();
    assert.equal(await page.getByRole('status').filter({ hasText: 'emailed shortly' }).count(), 0);
    assert.equal(await page.locator('#forgot-email').inputValue(), 'synthetic@example.com');
    results.push('PASS: delivery/configuration errors are visible, never false success');
    forgotStatus = 202;
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'emailed shortly' }).waitFor();
    assert.equal(requests.filter(row => row.kind === 'request').length, 2);
    assert.deepEqual(Object.keys(requests[0].body), ['email']);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    results.push('PASS: generic accepted state, email-only contract and Escape dismissal');
    await page.goto(base + '/#/reset-password?token=synthetic-link-token', { waitUntil: 'domcontentloaded' });
    await page.locator('#reset-new').waitFor();
    await page.waitForURL('**/#/reset-password');
    assert.ok(!page.url().includes('token='));
    await page.locator('#reset-new').fill('Synthetic-new-2026!');
    await page.locator('#reset-confirm').fill('Does-not-match-2026!');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'do not match' }).waitFor();
    assert.equal(requests.filter(row => row.kind === 'redeem').length, 0);
    results.push('PASS: reset URL token removed and mismatched passwords stay client-side');
    await page.locator('#reset-confirm').fill('Synthetic-new-2026!');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'invalid or expired' }).waitFor();
    resetStatus = 204;
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'updated' }).waitFor();
    assert.equal(requests.filter(row => row.kind === 'redeem').length, 2);
    assert.equal(await page.locator('#reset-new').count(), 0);
    results.push('PASS: invalid-link retry and successful reset without automatic login');
    await page.goto(base + '/#/reset-password?token=synthetic-second-link', { waitUntil: 'domcontentloaded' });
    await page.locator('#reset-new').waitFor();
    await page.locator('#reset-new').fill('Synthetic-new-2026!');
    await page.locator('#reset-confirm').fill('Synthetic-new-2026!');
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'updated' }).waitFor();
    assert.equal(requests.at(-1).body.token, 'synthetic-second-link');
    results.push('PASS: a new link in the same tab replaces the prior recovery target');
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto(base + '/#/reset-password?token=synthetic-mobile-link', { waitUntil: 'domcontentloaded' });
    await page.locator('#reset-new').waitFor();
    await page.locator('#reset-new').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Show password', exact: true }).evaluate(element => element === document.activeElement), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: new URL('reset-mobile-form.png', output).pathname.replace(/^\/(\w:)/, '$1') });
    results.push('PASS: mobile reset form fits and password visibility is keyboard reachable');
    await page.goto(base + '/#/reset-password', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').filter({ hasText: 'missing or invalid' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Update password', exact: true }).count(), 0);
    results.push('PASS: missing-token state cannot submit');
    await page.screenshot({ path: new URL('reset-mobile.png', output).pathname.replace(/^\/(\w:)/, '$1') });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('*')]
        .filter(element => element.getBoundingClientRect().right > innerWidth)
        .map(element => ({ tag: element.tagName, className: String(element.className), width: element.getBoundingClientRect().width })));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow));
    results.push('PASS: 320px layout remains within viewport');
    await context.close();
} finally {
    await browser.close();
}
for (const result of results) console.log(result);
console.log(`${results.length} browser checks passed; API calls intercepted; no real mail or password changes.`);
