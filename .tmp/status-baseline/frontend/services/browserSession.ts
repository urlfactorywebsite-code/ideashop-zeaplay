/** Non-secret browser intent and serialization; no credentials enter storage/events. */
const SIGNED_OUT = 'zea_browser_signed_out';
let signedOut = false;
let intent = 0;
let pending: Promise<unknown> = Promise.resolve();
export const browserSessionIntent = () => intent;
export const nextBrowserSessionIntent = () => ++intent;
export function isBrowserSignedOut(): boolean {
  try { return signedOut || localStorage.getItem(SIGNED_OUT) === '1'; } catch { return signedOut; }
}
export function markBrowserSignedOut(value: boolean): void {
  signedOut = value;
  try { if (value) localStorage.setItem(SIGNED_OUT, '1'); else localStorage.removeItem(SIGNED_OUT); } catch { /* Memory guard still applies. */ }
}
export function notifyBrowserSessionChanged(): void {
  try { localStorage.setItem('zea_session_changed', `${Date.now()}:${Math.random()}`); } catch { /* Storage is optional. */ }
}
export function serializeBrowserSession<T>(task: () => Promise<T>): Promise<T> {
  const run = () => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('zea-browser-session', task) : task();
  const result = pending.then(run, run);
  pending = result.catch(() => undefined);
  return result;
}
