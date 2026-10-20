import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  bindPushAccount, bounded, clearPushSession, endpointHash, getPushRegistration,
  publicKeyBytes, subscriptionMatchesKey, supportsBrowserPush, syncPushAccount,
} from '../services/pushBrowser.ts';

const events: string[] = [];
let accountMessages: unknown[] = [];
let values: Map<string, string>;
let subscription: any;
let registration: any;
let serviceWorker: any;
beforeEach(() => {
  events.length = 0;
  accountMessages = [];
  values = new Map([['vee_access_token', 'synthetic-A']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  const window = Object.assign(new EventTarget(), { isSecureContext: true, PushManager: class {}, Notification: class {} });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  subscription = {
    endpoint: 'https://fcm.googleapis.com/synthetic',
    unsubscribe: async () => { events.push('browser-unsubscribe'); return true; },
  };
  registration = {
    active: { scriptURL: 'https://example.com/sw.js', postMessage: (data: any, ports: MessagePort[]) => {
      accountMessages.push(data.account);
      events.push(data.account ? 'bind' : 'clear');
      ports[0].postMessage({ type: 'ZEA_PUSH_ACCOUNT_ACK', ok: true });
    } },
    pushManager: { getSubscription: async () => subscription },
  };
  serviceWorker = {
    getRegistration: async () => registration,
    register: async () => { events.push('register-own-worker'); return registration; },
    ready: Promise.resolve(registration),
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker } });
});

test('push support requires a secure context', () => {
  assert.equal(supportsBrowserPush(), true);
  Object.assign(window, { isSecureContext: false });
  assert.equal(supportsBrowserPush(), false);
});

test('registration refuses an unrelated worker without unregistering it', async () => {
  registration.active.scriptURL = 'https://example.com/other-app-worker.js';
  await assert.rejects(getPushRegistration(true), /Another application/);
  assert.deepEqual(events, []);
});

test('bound account is acknowledged before registration is considered ready', async () => {
  const account = { userId: 'user-A', tenantId: 'tenant-A' };
  await syncPushAccount(account, 'synthetic-A');
  assert.deepEqual(accountMessages, [account]);
  assert.deepEqual(events, ['register-own-worker', 'bind']);
});

test('stale authenticated tab cannot bind a prior account after token change', async () => {
  values.set('vee_access_token', 'synthetic-B');
  await assert.rejects(syncPushAccount({ userId: 'user-A', tenantId: 'tenant-A' }, 'synthetic-A'), /account changed/);
  assert.deepEqual(accountMessages, []);
});

test('a token change during registration prevents late stale account binding', async () => {
  serviceWorker.register = async () => {
    values.set('vee_access_token', 'synthetic-B');
    return registration;
  };
  await syncPushAccount({ userId: 'user-A', tenantId: 'tenant-A' }, 'synthetic-A');
  assert.deepEqual(accountMessages, []);
});

test('logout clears worker before server revoke and browser unsubscribe', async () => {
  await clearPushSession(async endpoint => {
    assert.equal(endpoint, subscription.endpoint);
    events.push('server-revoke');
  });
  assert.deepEqual(events, ['clear', 'server-revoke', 'browser-unsubscribe']);
  assert.deepEqual(accountMessages, [null]);
});

test('passive signed-out tab preserves the endpoint for the initiating logout to revoke', async () => {
  values.delete('vee_access_token');
  await syncPushAccount(null);
  assert.deepEqual(events, ['clear']);
  await clearPushSession(async endpoint => {
    assert.equal(endpoint, subscription.endpoint);
    events.push('server-revoke');
  });
  assert.deepEqual(events, ['clear', 'clear', 'server-revoke', 'browser-unsubscribe']);
});

test('logout unsubscribes locally even when server revocation fails', async () => {
  await assert.rejects(clearPushSession(async () => { events.push('server-offline'); throw new Error('offline'); }), /offline/);
  assert.deepEqual(events, ['clear', 'server-offline', 'browser-unsubscribe']);
});

test('logout unsubscribes even when worker refuses account acknowledgement', async () => {
  registration.active.postMessage = (_: unknown, ports: MessagePort[]) =>
    ports[0].postMessage({ type: 'ZEA_PUSH_ACCOUNT_ACK', ok: false });
  await assert.rejects(clearPushSession(), /secure notifications/);
  assert.deepEqual(events, ['browser-unsubscribe']);
});

test('failed worker operation does not poison subsequent account binding', async () => {
  const original = registration.active.postMessage;
  registration.active.postMessage = (_: unknown, ports: MessagePort[]) =>
    ports[0].postMessage({ type: 'ZEA_PUSH_ACCOUNT_ACK', ok: false });
  await assert.rejects(syncPushAccount({ userId: 'user-A', tenantId: 'tenant-A' }), /secure notifications/);
  registration.active.postMessage = original;
  await syncPushAccount({ userId: 'user-A', tenantId: 'tenant-A' });
  assert.deepEqual(events.slice(-1), ['bind']);
});

test('browser and backend compare endpoints with SHA256 without displaying endpoints', async () => {
  const endpoint = 'https://fcm.googleapis.com/test-id';
  assert.equal(await endpointHash(endpoint), createHash('sha256').update(endpoint).digest('hex'));
});

test('rotated application keys are distinguished from reusable subscriptions', () => {
  const key = publicKeyBytes('AQID');
  assert.deepEqual([...key], [1, 2, 3]);
  assert.equal(subscriptionMatchesKey({ options: { applicationServerKey: key.buffer } } as any, key), true);
  assert.equal(subscriptionMatchesKey({ options: { applicationServerKey: new Uint8Array([1, 2, 4]).buffer } } as any, key), false);
  assert.equal(subscriptionMatchesKey({ options: {} } as any, key), false);
});

test('worker waits are bounded and missing active worker reports a useful failure', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 'worker timeout', 5), /worker timeout/);
  await assert.rejects(bindPushAccount({ active: null } as any, null), /not active/);
});
