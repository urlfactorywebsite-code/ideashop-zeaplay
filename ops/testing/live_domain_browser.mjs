import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const frontend = 'https://ideashop.zeacrm.com';
const api = 'https://api.ideashop.zeacrm.com/api';
const checks = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  proxy: { server: process.env.ZEAPLAY_DOMAIN_TEST_PROXY },
  // Trust only the public key generated for this owned disposable TLS server.
  args: ['--ignore-certificate-errors-spki-list=' + process.env.ZEAPLAY_DOMAIN_TEST_SPKI],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(frontend, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => isSecureContext), true);
  assert.equal(await page.evaluate(() => window.__RUNTIME_CONFIG__.API_URL), api);
  checks.push('Secure frontend with runtime API domain');

  const login = await page.evaluate(async api => {
    const response = await fetch(api + '/auth/login', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Zea-Browser': '1' },
      body: JSON.stringify({ email: 'live-domains@example.com', password: 'Synthetic-domain-password!' }),
    });
    return { status: response.status, data: await response.json() };
  }, api);
  assert.equal(login.status, 200);
  checks.push('Real cross-origin credentialed login');
  const cookies = await context.cookies();
  const session = cookies.find(cookie => cookie.name === '__Host-zea_browser_session');
  assert.ok(session && session.domain === 'api.ideashop.zeacrm.com' && session.secure && session.httpOnly && session.sameSite === 'Lax');
  checks.push('Secure HttpOnly host-only API session cookie');

  const refresh = page.waitForResponse(response => response.url() === api + '/auth/browser-session/refresh' && response.status() === 200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await refresh;
  checks.push('Frontend reload restores session through API domain');

  const socketResults = await page.evaluate(async ({ api, token }) => {
    const headers = { Authorization: 'Bearer ' + token };
    const ticket = await fetch(api + '/auth/websocket-ticket?scope=tasks', { headers }).then(r => r.json());
    const presence = await fetch(api + '/auth/presence-token', { headers }).then(r => r.json());
    const websocket = (url, authenticate) => new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => { socket.close(); reject(new Error('Socket handshake timeout')); }, 10000);
      const done = () => { clearTimeout(timeout); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error('Socket handshake failed')); };
      socket.onopen = () => { if (!authenticate) done(); };
      socket.onmessage = event => {
        if (!authenticate) return;
        if (event.data.startsWith('0')) socket.send('40' + JSON.stringify({ token: authenticate }));
        if (event.data.startsWith('40')) done();
        if (event.data.startsWith('44')) { clearTimeout(timeout); reject(new Error('Presence authentication rejected')); socket.close(); }
      };
    });
    return [await websocket(api.replace('https:', 'wss:') + '/ws/tasks?token=' + encodeURIComponent(ticket.access_token)),
      await websocket('wss://api.ideashop.zeacrm.com/socket.io/?EIO=4&transport=websocket', presence.access_token)];
  }, { api, token: login.data.token.access_token });
  assert.deepEqual(socketResults, [true, true]);
  checks.push('Authenticated native task WebSocket on API host', 'Authenticated Socket.IO presence on API host');

  const oauth = await page.evaluate(async ({ api, token, frontend }) => {
    const json = async (path, payload) => {
      const response = await fetch(api + path, { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + token,
      }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error('OAuth ' + path + ': ' + response.status + ' ' + JSON.stringify(body));
      return body;
    };
    const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const verifier = b64(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64(crypto.getRandomValues(new Uint8Array(32)));
    const redirect = frontend + '/callback';
    const registered = await json('/oauth2/clients', { name: 'Isolated live-domain PKCE client', client_type: 'public',
      redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], scopes: ['profile:read', 'offline_access'] });
    const params = { client_id: registered.client.client_id, redirect_uri: redirect, response_type: 'code',
      scope: 'profile:read offline_access', state, code_challenge: challenge, code_challenge_method: 'S256' };
    const prepared = await json('/oauth2/consent/prepare', params);
    const allowed = await json('/oauth2/consent', { ticket: prepared.ticket, allow: true });
    const callback = new URL(allowed.redirect_to);
    if (callback.searchParams.get('iss') !== api + '/oauth2' || callback.searchParams.get('state') !== state) throw new Error('Invalid canonical issuer/state');
    const response = await fetch(api + '/oauth2/token', { method: 'POST', credentials: 'omit',
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client.client_id,
        redirect_uri: redirect, code_verifier: verifier, code: callback.searchParams.get('code') }) });
    const granted = await response.json();
    const profile = await fetch(api + '/oauth2/profile', { credentials: 'omit', headers: { Authorization: 'Bearer ' + granted.access_token } });
    return { exchange: response.status, profile: profile.status, issuer: callback.searchParams.get('iss') };
  }, { api, token: login.data.token.access_token, frontend });
  assert.deepEqual(oauth, { exchange: 200, profile: 200, issuer: api + '/oauth2' });
  checks.push('Real browser consent, canonical issuer and PKCE token exchange', 'Scoped OAuth profile on API domain');
  const logout = await page.evaluate(async api => {
    const headers = { 'X-Zea-Browser': '1', 'Content-Type': 'application/json' };
    const ended = await fetch(api + '/auth/browser-session/logout', { method: 'POST', credentials: 'include', headers, body: '{}' });
    const restored = await fetch(api + '/auth/browser-session/refresh', { method: 'POST', credentials: 'include', headers, body: '{}' });
    return [ended.status, restored.status];
  }, api);
  assert.deepEqual(logout, [204, 401]);
  checks.push('Browser logout revokes API-host session');
} finally {
  await browser.close();
  await writeFile(process.env.ZEAPLAY_DOMAIN_BROWSER_OUTPUT, JSON.stringify({ passed: checks.length === 9, checks }, null, 2));
}
console.log(JSON.stringify({ passed: true, checks: checks.length }));
