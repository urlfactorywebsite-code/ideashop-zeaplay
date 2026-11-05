import { clearProfileCache } from './profileEvents';
const ACCESS_TOKEN_KEY = 'vee_access_token';
const REFRESH_TOKEN_KEY = 'vee_refresh_token';
let accessTokenMemory: string | null = null;
let refreshTokenMemory: string | null = null;
let generation = 0;
// Remove credentials persisted by earlier versions. Existing sessions sign in once
// after this migration; future reloads recover through the HttpOnly browser cookie.
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem('zea-play::bearer-key-history');
  } catch { /* Authentication remains usable when browser storage is unavailable. */ }
}
export const tokenGeneration = () => generation;
export const AUTH_TOKEN_REFRESHED_EVENT = 'zea:auth-token-refreshed';

export function storeRefreshedTokens(previousAccessToken: string | null, previousRefreshToken: string,
  accessToken: string, refreshToken: string): boolean {
  if (getAccessToken() !== previousAccessToken || getRefreshToken() !== previousRefreshToken) return false;
  const previousGeneration = generation;
  storeTokens(accessToken, refreshToken);
  window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: { previousGeneration, generation } }));
  return true;
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  accessTokenMemory = accessToken;
  refreshTokenMemory = refreshToken;
  ++generation;
}

export function getAccessToken(): string | null {
  return accessTokenMemory;
}

export function getRefreshToken(): string | null {
  return refreshTokenMemory;
}

export function clearTokens(): void {
  clearProfileCache();
  accessTokenMemory = refreshTokenMemory = null;
  ++generation;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch { /* Credentials are already cleared from memory. */ }
}
