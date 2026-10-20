// Browser-only push lifecycle. No credentials or subscription keys are persisted here.
import { getAccessToken } from './tokenStorage';
export type PushAccount = { userId: string; tenantId: string };
export const PUSH_STATE_EVENT = 'zea:push-state';
const PUSH_STORAGE_KEY = 'zea-push-state';
const WAIT_MS = 10000;
let accountQueue: Promise<unknown> = Promise.resolve();
let expectedAccount: string | null = null;

const identity = (account: PushAccount | null) =>
  account ? `${account.tenantId}:${account.userId}` : null;

export function supportsBrowserPush(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function bounded<T>(promise: Promise<T>, message: string, timeout = WAIT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    promise.then(value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); });
  });
}

export async function getPushRegistration(create = false): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  let registration = await bounded(navigator.serviceWorker.getRegistration('/'),
    'The notification worker is not responding. Refresh this page and try again.');
  const script = registration?.active?.scriptURL ?? registration?.waiting?.scriptURL
    ?? registration?.installing?.scriptURL;
  if (script && new URL(script).pathname !== '/sw.js') {
    throw new Error('Another application uses this notification scope. Contact your administrator.');
  }
  if (create) {
    registration = await bounded(navigator.serviceWorker.register('/sw.js', {
      scope: '/', updateViaCache: 'none',
    }), 'Unable to start the notification worker. Refresh this page and try again.');
  }
  if (registration && !registration.active) {
    registration = await bounded(navigator.serviceWorker.ready,
      'The notification worker did not start. Refresh this page and try again.');
  }
  const installing = registration?.installing;
  if (installing) {
    await bounded(new Promise<void>((resolve, reject) => {
      const check = () => {
        if (installing.state === 'activated' || installing.state === 'redundant') {
          installing.removeEventListener('statechange', check);
          if (installing.state === 'activated') resolve();
          else reject(new Error('The notification worker update failed. Refresh and try again.'));
        }
      };
      installing.addEventListener('statechange', check);
      check();
    }), 'The notification worker is updating. Refresh this page and try again.');
  }
  return registration ?? null;
}

export async function bindPushAccount(
  registration: ServiceWorkerRegistration, account: PushAccount | null,
): Promise<void> {
  const worker = registration.active;
  if (!worker) throw new Error('The notification worker is not active. Refresh and try again.');
  const channel = new MessageChannel();
  try {
    await bounded(new Promise<void>((resolve, reject) => {
      channel.port1.onmessage = ({ data }) => {
        if (data?.type !== 'ZEA_PUSH_ACCOUNT_ACK') return;
        if (data.ok) resolve();
        else reject(new Error('Unable to secure notifications for this account. Refresh and try again.'));
      };
      worker.postMessage({ type: 'ZEA_PUSH_ACCOUNT', account }, [channel.port2]);
    }), 'The notification worker needs an update. Reload this page and try again.', 5000);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

export function isCurrentPushAccount(account: PushAccount): boolean {
  return expectedAccount === identity(account);
}

export function notifyPushChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PUSH_STATE_EVENT));
  try { localStorage.setItem(PUSH_STORAGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* storage may be disabled */ }
}

export function isPushStorageEvent(event: StorageEvent): boolean {
  return event.key === PUSH_STORAGE_KEY;
}

export function syncPushAccount(account: PushAccount | null, token = getAccessToken()): Promise<void> {
  if (token !== getAccessToken()) return Promise.reject(new Error('Your account changed. Refresh and try again.'));
  expectedAccount = identity(account);
  const operation = accountQueue.catch(() => undefined).then(async () => {
    if (expectedAccount !== identity(account) || token !== getAccessToken()) return;
    const registration = await getPushRegistration(Boolean(account) && supportsBrowserPush());
    if (!registration || expectedAccount !== identity(account) || token !== getAccessToken()) return;
    await bindPushAccount(registration, account);
    if (!account) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }
  });
  accountQueue = operation;
  return operation;
}

export function clearPushSession(revoke?: (endpoint: string) => Promise<unknown>): Promise<void> {
  expectedAccount = null;
  const operation = accountQueue.catch(() => undefined).then(async () => {
    const registration = await getPushRegistration();
    if (!registration) return;
    // Clear the worker's account first, including notifications already on screen.
    // Even if the server is offline, unsubscribe the browser to stop future delivery.
    let bindingError: unknown;
    try { await bindPushAccount(registration, null); } catch (error) { bindingError = error; }
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try { if (revoke) await revoke(subscription.endpoint); }
      finally { await subscription.unsubscribe(); }
    }
    notifyPushChanged();
    if (bindingError) throw bindingError;
  });
  accountQueue = operation;
  return operation;
}

export function publicKeyBytes(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export function subscriptionMatchesKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
}
