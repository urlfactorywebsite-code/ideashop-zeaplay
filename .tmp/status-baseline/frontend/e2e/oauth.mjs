import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const playwright = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!playwright) throw new Error('Set ZEAPLAY_PLAYWRIGHT_MODULE');
const { chromium } = await import(pathToFileURL(playwright).href);
const { expect } = await import(new URL('test.mjs', pathToFileURL(playwright)).href);
const base = 'http://127.0.0.1:6304';
const api = 'http://127.0.0.1:6321/api';
const output = new URL(process.env.ZEAPLAY_OAUTH_CHECKS_PATH || '../../docs/oauth/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const thirdPartyServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<title>Controlled third-party browser client</title>');
});
await new Promise((resolve, reject) => { thirdPartyServer.once('error', reject); thirdPartyServer.listen(6305, '127.0.0.1', resolve); });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:6321' && (url.pathname.startsWith('/api/oauth2') || url.pathname.startsWith('/api/auth/'))) return route.continue();
    const body = /count/.test(url.pathname) ? { count: 0, unread_count: 0 } : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + '/#/api/overview');
  await page.locator('#email-address').fill('oauth-browser@example.com');
  await page.locator('#password').fill('Synthetic-browser-only!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'OAuth', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OAuth management', exact: true })).toBeVisible();
  await expect(page.getByText('Total OAuth clients', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('vee_access_token'), localStorage.getItem('vee_refresh_token')]), [null, null]);
  assert.ok((await context.cookies(api + '/auth/browser-session/refresh')).some(c => c.name === 'zea_browser_session' && c.httpOnly));
  results.push('Existing login, OAuth tab and memory-only credentials PASS');

  await page.getByRole('button', { name: 'Register application', exact: true }).click();
  await page.getByLabel('Application name', { exact: true }).fill('Browser PKCE test');
  await page.getByLabel('Registered redirect URIs · one per line').fill(base + '/callback');
  await page.getByLabel('refresh_token', { exact: true }).check();
  await page.getByLabel(/offline_access ·/).check();
  await page.getByRole('button', { name: 'Create application', exact: true }).click();
  const credentialDialog = page.getByRole('dialog');
  await expect(credentialDialog.getByRole('heading', { name: 'Application credentials' })).toBeVisible();
  const clientId = await credentialDialog.locator('code').first().textContent();
  await credentialDialog.getByRole('button', { name: 'I have saved the credentials' }).click();
  results.push('Client registration and one-time credential dialog PASS');

  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: base + '/callback',
    scope: 'profile:read offline_access', state, code_challenge: challenge, code_challenge_method: 'S256' });
  await page.goto(api + '/oauth2/authorize?' + params);
  await expect(page.getByRole('heading', { name: 'Browser PKCE test requests access' })).toBeVisible();
  await expect(page.getByText('This application’s identity has not been independently verified.', { exact: false })).toBeVisible();
  await page.screenshot({ path: new URL('consent-desktop.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  await page.getByRole('button', { name: 'Allow access' }).click();
  await page.waitForURL(url => url.pathname === '/callback' && url.searchParams.has('code'));
  const callback = new URL(page.url());
  assert.equal(callback.searchParams.get('state'), state);
  assert.equal(callback.searchParams.get('iss'), api + '/oauth2');
  const exchange = await context.request.post(api + '/oauth2/token', { form: { grant_type: 'authorization_code', client_id: clientId,
    code: callback.searchParams.get('code'), redirect_uri: base + '/callback', code_verifier: verifier } });
  assert.equal(exchange.status(), 200);
  const token = await exchange.json();
  const profile = await context.request.get(api + '/oauth2/profile', { headers: { Authorization: 'Bearer ' + token.access_token } });
  assert.equal(profile.status(), 200);
  const thirdParty = await context.newPage();
  await thirdParty.goto('http://127.0.0.1:6305/');
  const browserRead = await thirdParty.evaluate(async ({ api, access }) => {
    const response = await fetch(api + '/oauth2/profile', { credentials: 'omit', headers: { Authorization: 'Bearer ' + access } });
    return { status: response.status, profile: await response.json() };
  }, { api, access: token.access_token });
  assert.equal(browserRead.status, 200);
  await thirdParty.close();
  results.push('Separate-origin browser reads scoped profile with real CORS and no cookies PASS');
  const rotated = await context.request.post(api + '/oauth2/token', { form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: token.refresh_token } });
  assert.equal(rotated.status(), 200);
  const successor = await rotated.json();
  assert.notEqual(successor.refresh_token, token.refresh_token);
  results.push('Real browser consent → callback state/issuer → PKCE exchange → profile → refresh rotation PASS');

  await page.goto(base + '/#/oauth/applications');
  await expect(page.getByRole('heading', { name: 'Browser PKCE test' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  assert.equal((await context.request.get(api + '/oauth2/profile', { headers: { Authorization: 'Bearer ' + successor.access_token } })).status(), 401);
  results.push('User grant revocation enforces access denial PASS');

  await page.goto(base + '/#/api/oauth-apps');
  await expect(page.getByRole('heading', { name: 'OAuth management', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Register application', exact: true }).click();
  await page.getByLabel('Application name', { exact: true }).fill('Machine test');
  await page.getByLabel('Client type', { exact: true }).selectOption('confidential');
  await page.getByLabel('authorization_code', { exact: true }).uncheck();
  await page.getByLabel('client_credentials', { exact: true }).check();
  await page.getByLabel(/profile:read ·/).uncheck();
  await page.getByLabel(/service:read ·/).check();
  await page.getByRole('button', { name: 'Create application', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Application credentials' })).toBeVisible();
  const machineId = await page.getByRole('dialog').locator('code').nth(0).textContent();
  const machineSecret = await page.getByRole('dialog').locator('code').nth(1).textContent();
  const machine = await context.request.post(api + '/oauth2/token', { form: { grant_type: 'client_credentials', scope: 'service:read' }, headers: { Authorization: 'Basic ' + Buffer.from(machineId + ':' + machineSecret).toString('base64') } });
  assert.equal(machine.status(), 200);
  const machineToken = await machine.json();
  assert.ok(!machineToken.refresh_token);
  assert.equal((await context.request.get(api + '/oauth2/service', { headers: { Authorization: 'Bearer ' + machineToken.access_token } })).status(), 200);
  await page.getByRole('button', { name: 'I have saved the credentials' }).click();
  assert.ok(!(await page.content()).includes(machineSecret));
  results.push('Confidential machine flow and secret dismissal PASS');

  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'OAuth Clients', exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Page overflow at ${width}`);
    await page.screenshot({ path: new URL(`management-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Register application', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('vee_access_token'), localStorage.getItem('vee_refresh_token'), localStorage.getItem('zea-play::bearer-key-history')]), [null, null, null]);
  results.push('Responsive 1440/768/375, reduced motion, keyboard dialog and no token persistence PASS');
  // A network failure during logout must never silently restore the cookie on reload.
  await page.route('**/auth/browser-session/logout', route => route.abort());
  await page.evaluate(async () => { const { default: api } = await import('/services/mockApi.ts'); api.logout(); });
  await page.reload();
  await expect(page.locator('#email-address')).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('zea_browser_signed_out')), '1');
  await page.unroute('**/auth/browser-session/logout');
  await page.locator('#email-address').fill('oauth-browser@example.com');
  await page.locator('#password').fill('Synthetic-browser-only!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'OAuth management', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('zea_browser_signed_out')), null);
  results.push('Failed logout stays signed out across reload; explicit login recovers PASS');
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  await writeFile(new URL('browser-results.json', output), JSON.stringify({ results, pageErrors }, null, 2));
  console.log(results.join('\n'));
} finally { await browser.close(); await new Promise(resolve => thirdPartyServer.close(resolve)); }
