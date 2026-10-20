const ACCESS_TOKEN_KEY = 'vee_access_token';
const REFRESH_TOKEN_KEY = 'vee_refresh_token';
export const AUTH_TOKEN_REFRESHED_EVENT = 'zea:auth-token-refreshed';

export function storeRefreshedTokens(previousAccessToken: string | null, previousRefreshToken: string,
  accessToken: string, refreshToken: string): boolean {
  if (getAccessToken() !== previousAccessToken || getRefreshToken() !== previousRefreshToken) return false;
  storeTokens(accessToken, refreshToken);
  window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: { previousAccessToken, accessToken } }));
  return true;
}

export function storeTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
