import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const base = process.env.ZEAPLAY_SMTP_TEST_URL || 'http://127.0.0.1:6302';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Loopback tests only');
const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const tailwind = process.env.ZEAPLAY_TEST_TAILWIND_PATH ? await readFile(process.env.ZEAPLAY_TEST_TAILWIND_PATH, 'utf8') : 'window.tailwind={};';
const results = [];
const output = new URL(process.env.ZEAPLAY_SMTP_CHECKS_PATH || '../../docs/smtp-management/', import.meta.url);
const instant = new Date().toISOString();
let profiles = [], failedRead = false, heldCreate, holdCreate = false, showRetired = false, failTestRequest = false;
const writes = [], testMessages = [], connections = [], retries = [];
const stats = { smtp_accepted: 9, failed_attempts: 7, uncertain_attempts: 1, success_percentage: 56.25, average_processing_ms: 15, attempts_last_minute: 1 };
const jobs = [{ id: 'synthetic-due', category: 'otp', state: 'retrying', attempts: 1, max_attempts: 5, next_attempt_at: instant, created_at: instant, can_retry: true },
    { id: 'synthetic-unknown', category: 'notifications', state: 'uncertain', attempts: 1, max_attempts: 5, next_attempt_at: null, created_at: instant, can_retry: false }];
async function setup(role = 'owner') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
        localStorage.setItem('vee_access_token', 'synthetic-local-only');
        for (const base of ['/api', 'http://localhost:6311/api', 'https://synthetic-old-api.invalid/api']) {
            for (const key of ['smtp-multiple', 'smtp-config']) localStorage.setItem(`zea-play-cache:${encodeURIComponent(base)}:${key}`, JSON.stringify({ value: [{ password: 'synthetic-retired-cache-value' }], expiresAt: Date.now() + 600000 }));
        }
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'application/javascript', body: tailwind });
        if (path.endsWith('/api/auth/me')) return json({ id: 'synthetic-owner', role, name: 'Synthetic Admin', email: 'admin@example.com', status: 'active', tenant_id: '00000000-0000-0000-0000-000000000001' });
        if (path.includes('/api/config/smtp')) {
            if (failedRead && request.method() === 'GET') return json({ detail: { message: 'Synthetic metrics unavailable' } }, 503);
            if (path.endsWith('/health')) return json({ ...stats, profiles: profiles.length, enabled_profiles: profiles.filter(p => p.is_enabled).length, healthy_profiles: 0,
                ...(showRetired ? { smtp_accepted: 11, failed_attempts: 8, success_percentage: 57.89 } : {}),
                queue: { queued: 6, sending: 0, retrying: 1, failed: 0, uncertain: 1, sent: 9 }, as_of: instant, window_start: instant, window_hours: Number(url.searchParams.get('hours') || 24),
                profile_stats: { ...Object.fromEntries(profiles.map(p => ['multi:' + p.id, stats])), ...(showRetired ? { 'multi:retired': { ...stats, smtp_accepted: 2, failed_attempts: 1 } } : {}) },
                retired_profile_keys: showRetired ? ['multi:retired'] : [], definitions: { queue: 'Current tenant jobs across all time', smtp_accepted: 'SMTP acceptance does not confirm inbox delivery' } });
            if (path.endsWith('/queue/retry')) { retries.push(request.postDataJSON()); return json({ selected: 1, skipped: 0 }); }
            if (path.endsWith('/queue')) return json({ items: jobs });
            if (path.endsWith('/attempts')) return json({ items: [] });
            if (path.endsWith('/connection')) { connections.push(path); return json({ detail: { code: 'authentication_failed', message: 'SMTP authentication failed.' } }, 400); }
            if (path.endsWith('/test')) {
                testMessages.push(request.postDataJSON());
                if (failTestRequest) return json({ detail: 'Synthetic server failure after an unknown outcome' }, 500);
                return json({ status: 'smtp_accepted', message: 'Message accepted by SMTP server; inbox delivery is not confirmed.' }, 202);
            }
            if (request.method() === 'GET') return json(profiles);
            const payload = request.postDataJSON(); writes.push({ method: request.method(), payload });
            if (request.method() === 'POST') {
                if (holdCreate) await new Promise(resolve => { heldCreate = resolve; });
                const { password, ...settings } = payload;
                const profile = { ...settings, id: 'synthetic-profile', has_password: !!password, secret_encrypted: true, health: 'untested', created_at: instant, updated_at: instant, last_test_at: null, last_test_code: null };
                profiles.push(profile); return json(profile, 201);
            }
            profiles[0] = { ...profiles[0], ...payload };
            profiles[0].health = profiles[0].is_enabled ? 'untested' : 'disabled';
            return json(profiles[0]);
        }
        if (path.includes('/api/')) return json([]);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        return route.continue();
    });
    await page.goto(base + '/#/api/smtp', { waitUntil: 'domcontentloaded' });
    return { page, context, errors };
}
try {
    const { page, context, errors } = await setup();
    const smtp = page.locator('.smtp-management');
    await expect(smtp.getByText('No tenant-owned SMTP profiles yet.')).toBeVisible();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /:smtp-(?:multiple|config)/.test(key))), false);
    assert.equal(testMessages.length + connections.length, 0);
    results.push('PASS empty state and no automatic SMTP tests');
    await smtp.getByRole('button', { name: 'New SMTP profile' }).click();
    await expect(smtp.getByRole('heading', { name: 'Create SMTP Profile', exact: true })).toBeVisible();
    await expect(smtp.getByLabel('Profile name', { exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(smtp.getByLabel('Provider', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(smtp.getByLabel('Profile name', { exact: true })).toBeFocused();
    await smtp.getByLabel('Profile name', { exact: true }).fill('Synthetic relay');
    await smtp.getByLabel('SMTP host', { exact: true }).fill('custom.example.com');
    await smtp.getByLabel('Provider', { exact: true }).selectOption('gmail');
    await expect(smtp.getByLabel('SMTP host', { exact: true })).toHaveValue('custom.example.com');
    await smtp.getByLabel('Username', { exact: true }).fill('sender@example.com');
    await smtp.getByLabel('Password / app password', { exact: true }).fill('synthetic-not-a-live-secret');
    await smtp.getByLabel('Profile name', { exact: true }).fill('   ');
    await smtp.getByRole('button', { name: 'Save profile', exact: true }).click();
    assert.equal(writes.length, 0);
    await smtp.getByLabel('Profile name', { exact: true }).fill('Synthetic relay');
    holdCreate = true;
    await smtp.getByRole('button', { name: 'Save profile', exact: true }).dblclick({ force: true });
    await expect.poll(() => writes.length).toBe(1);
    assert.equal(writes[0].method, 'POST'); heldCreate(); holdCreate = false;
    await expect(smtp.getByRole('status')).toContainText('SMTP profile created.');
    await expect(page.getByText('SMTP profile created.', { exact: true })).toHaveCount(2); // Persistent status plus existing app toast.
    await expect(page.locator('[data-app-toast]')).toHaveCSS('bottom', '96px');
    await expect(page.locator('[data-app-toast] > div')).toHaveCSS('background-color', 'rgb(18, 59, 49)');
    assert.equal(await smtp.locator('input[type=password]').count(), 0);
    await smtp.getByRole('button', { name: 'Edit Synthetic relay', exact: true }).click();
    await expect(smtp.getByLabel('Password / app password', { exact: true })).toHaveValue('');
    await expect(smtp.getByLabel('Password / app password', { exact: true })).toHaveAttribute('placeholder', 'Leave blank to keep existing password');
    await smtp.getByLabel('Priority (lower is tried first)', { exact: true }).fill('12');
    await smtp.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    assert.equal(writes[1].method, 'PATCH'); assert.equal('password' in writes[1].payload, false); assert.equal(profiles.length, 1);
    results.push('PASS create/edit separation, provider preserves edits, blank secret omitted, duplicate click guarded');
    await smtp.getByRole('button', { name: 'Test connection: Synthetic relay', exact: true }).click();
    await expect(smtp.getByRole('alert')).toContainText('SMTP authentication failed');
    assert.equal(testMessages.length, 0);
    await smtp.getByRole('button', { name: 'Send test email: Synthetic relay', exact: true }).click();
    await smtp.locator('.smtp-test-form input[type=email]').fill('explicit@example.com');
    await smtp.locator('.smtp-test-form button[type=submit]').click();
    await expect(smtp.getByRole('status')).toContainText('Message accepted by SMTP server');
    assert.equal(testMessages.length, 1); assert.equal(testMessages[0].to_address, 'explicit@example.com');
    await smtp.getByRole('button', { name: 'Disable Synthetic relay', exact: true }).click();
    await expect(smtp.getByRole('button', { name: 'Enable Synthetic relay', exact: true })).toBeVisible();
    results.push('PASS connection failure shown honestly, explicit recipient test, enable/disable');
    failTestRequest = true;
    await smtp.getByRole('button', { name: 'Send test email: Synthetic relay', exact: true }).click();
    await smtp.locator('.smtp-test-form input[type=email]').fill('explicit@example.com');
    await smtp.locator('.smtp-test-form button[type=submit]').click();
    await expect(smtp.getByRole('alert')).toContainText('SMTP request status is unknown. Refresh the attempt log before retrying');
    assert.equal(testMessages.length, 2);
    await smtp.getByRole('button', { name: 'Cancel test', exact: true }).click();
    failTestRequest = false;
    await expect(smtp.getByLabel('Select job synthetic-unknown')).toBeDisabled();
    await smtp.getByLabel('Select job synthetic-due').check();
    await smtp.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(smtp.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(smtp.getByLabel('Select job synthetic-due')).toBeChecked();
    await smtp.getByLabel('Time range', { exact: true }).selectOption('1');
    await expect(smtp.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(smtp.getByLabel('Select job synthetic-due')).toBeChecked();
    await smtp.getByRole('button', { name: 'Retry 1 eligible jobs', exact: true }).click();
    await expect(smtp.getByRole('status')).toContainText('1 eligible jobs selected; 0 skipped');
    assert.deepEqual(retries, [{ ids: ['synthetic-due'] }]);
    await expect(smtp.getByText('SMTP accepted', { exact: true })).toBeVisible();
    showRetired = true;
    await smtp.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(smtp.getByText('Retired profiles in this window: 1. Accepted 2 · Failed attempts 1. These remain included in the totals.', { exact: true })).toBeVisible();
    results.push('PASS metrics distinguish acceptance and job states; retry selection excludes uncertain jobs');
    profiles[0] = { ...profiles[0], provider: 'zoho', host: 'smtppro.zoho.in' };
    await smtp.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(smtp.getByText('smtppro.zoho.in:587 · Priority 12', { exact: true })).toBeVisible();
    await smtp.getByRole('button', { name: 'Edit Synthetic relay', exact: true }).click();
    await expect(smtp.getByLabel('Provider region', { exact: true })).toHaveValue('in');
    await expect(smtp.getByLabel('Paid organization account (smtppro)', { exact: true })).toBeChecked();
    await smtp.getByRole('button', { name: 'Cancel editing', exact: true }).click();
    await expect(smtp.getByRole('button', { name: 'New SMTP profile' })).toBeFocused();
    results.push('PASS legacy SMTP caches cleared, native name validation, refresh preserves selections, regional edit controls and cancel focus');
    await smtp.getByRole('button', { name: 'New SMTP profile' }).click();
    for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await smtp.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
        assert.ok(geometry.scroll <= geometry.width + 2, `SMTP overflow at ${width}: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.left >= -1 && geometry.right <= width + 1, `SMTP outside viewport at ${width}: ${JSON.stringify(geometry)}`);
        const targets = await smtp.locator('button:visible').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 43));
        assert.ok(targets, `Touch targets below 44px at ${width}`);
        if (width < 550 && await page.locator('[data-app-toast]').count()) {
            const toast = await page.locator('[data-app-toast]').boundingBox();
            assert.ok(toast.y + toast.height <= 920, 'SMTP toast must clear the mobile bottom navigation');
        }
        await smtp.evaluate(el => el.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: fileURLToPath(new URL(`ui-${width}.png`, output)) });
    }
    await smtp.getByRole('button', { name: 'Cancel editing', exact: true }).click();
    failedRead = true;
    await smtp.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(smtp.getByRole('alert')).toContainText('Synthetic metrics unavailable'); failedRead = false;
    await smtp.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(smtp.getByRole('alert')).toHaveCount(0);
    await page.goto(base + '/#/api/overview');
    await page.getByRole('button', { name: 'SMTP', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'SMTP Management', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    results.push('PASS 320/390/768/1440 layout, cancel, load errors, existing API SMTP tab, no runtime errors');
    await context.close();
    const admin = await setup('admin');
    await expect(admin.page.getByRole('heading', { name: 'SMTP Management', exact: true })).toBeVisible();
    await admin.context.close();
    const manager = await setup('manager');
    await expect(manager.page.getByRole('heading', { name: 'SMTP Management', exact: true })).toHaveCount(0);
    await manager.context.close();
    results.push('PASS Admin SMTP-only route; Manager blocked without opening OAuth access');
    await writeFile(new URL('browser-results.json', output), JSON.stringify({ results, externalMessages: 0, transport: 'intercepted synthetic API; real transport covered by backend suite' }, null, 2));
    console.log(results.join('\n'));
} finally { await browser.close(); }
