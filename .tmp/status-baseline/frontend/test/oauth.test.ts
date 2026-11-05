import assert from 'node:assert/strict';
import test from 'node:test';
import { createPkce, validateAuthorizationCallback } from '../utils/oauthClient.ts';

test('PKCE is unpredictable and uses S256 with an RFC 7636 length verifier', async () => {
  const a = await createPkce(); const b = await createPkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.verifier, b.verifier); assert.notEqual(a.state, b.state);
  assert.equal(a.method, 'S256');
});

test('client rejects state/issuer mismatch, missing or duplicate code before exchange', () => {
  const issuer = 'https://api.example.com/api/oauth2';
  const base = 'https://client.example.com/cb?state=expected&iss=' + encodeURIComponent(issuer);
  assert.equal(validateAuthorizationCallback(base + '&code=valid', 'expected', issuer), 'valid');
  for (const url of [base + '&code=a&code=b', base, base.replace('expected', 'wrong') + '&code=a', base + '&code=a&state=expected', base + '&error=access_denied']) {
    assert.throws(() => validateAuthorizationCallback(url, 'expected', issuer));
  }
  assert.throws(() => validateAuthorizationCallback(base + '&code=a', 'expected', 'https://wrong.example'));
});

test('tokens remain in memory, refresh cannot overwrite logout or a new account', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const tokens = await import('../services/tokenStorage.ts');
  tokens.storeTokens('private-access', 'private-refresh');
  assert.equal(storage.size, 0);
  tokens.clearTokens();
  assert.equal(tokens.storeRefreshedTokens('private-access', 'private-refresh', 'late', 'late-refresh'), false);
  assert.equal(tokens.getAccessToken(), null);
  tokens.storeTokens('new-account', 'new-refresh');
  assert.equal(tokens.storeRefreshedTokens(null, 'private-refresh', 'stale', 'stale-refresh'), false);
  assert.equal(tokens.getAccessToken(), 'new-account');
  assert.equal(storage.size, 0);
});

test('refresh events contain generation numbers and never credential material', async () => {
  const tokens = await import('../services/tokenStorage.ts');
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  let detail: unknown;
  target.addEventListener(tokens.AUTH_TOKEN_REFRESHED_EVENT, event => { detail = (event as CustomEvent).detail; });
  tokens.storeTokens('secret-original', 'secret-refresh');
  assert.equal(tokens.storeRefreshedTokens('secret-original', 'secret-refresh', 'secret-successor', 'secret-next'), true);
  assert.ok(!JSON.stringify(detail).includes('secret'));
  assert.equal(typeof (detail as any).generation, 'number');
});

test('logout intent blocks cookie restoration and serializes subsequent login', async () => {
  const session = await import('../services/browserSession.ts');
  session.markBrowserSignedOut(true);
  assert.equal(session.isBrowserSignedOut(), true);
  const order: string[] = [];
  let finish!: () => void;
  const logout = session.serializeBrowserSession(() => new Promise<void>(resolve => { finish = () => { order.push('logout'); resolve(); }; }));
  const login = session.serializeBrowserSession(async () => { order.push('login'); session.markBrowserSignedOut(false); });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, []);
  finish(); await logout; await login;
  assert.deepEqual(order, ['logout', 'login']);
  assert.equal(session.isBrowserSignedOut(), false);
});
