import { getAccessToken } from './tokenStorage';
import { getApiBaseUrl, readEndpoint } from './endpoints';

const API_BASE_URL = getApiBaseUrl();

type TokenResponse = {
  access_token?: string;
};

const fetchSocketToken = async (
  path: string,
  options: { fallbackToAccessToken?: boolean } = {},
): Promise<string | null> => {
  const fallbackToAccessToken = options.fallbackToAccessToken ?? true;
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return fallbackToAccessToken ? accessToken : null;
    }
    const data = (await response.json()) as TokenResponse;
    return data.access_token || (fallbackToAccessToken ? accessToken : null);
  } catch {
    return fallbackToAccessToken ? accessToken : null;
  }
};

export const getWebSocketTicket = (scope: 'chat' | 'tasks' | 'tickets') =>
  fetchSocketToken(`/auth/websocket-ticket?scope=${encodeURIComponent(scope)}`, {
    fallbackToAccessToken: false,
  });

export const getPresenceSocketToken = () => fetchSocketToken('/auth/presence-token');

export const resolveSameOriginUrl = (value?: string | null): string | null => {
  if (typeof window === 'undefined') return null;
  if (!value || value === 'same-origin') {
    return window.location.origin;
  }
  return value;
};

export const resolvePresenceSocketUrl = (): string | null => {
  const configured = readEndpoint('PRESENCE_URL', readEndpoint('CHAT_URL'));
  if (configured) return resolveSameOriginUrl(configured);
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:6312' : window.location.origin;
};

export const toWebSocketBaseUrl = (base: string): string => {
  if (typeof window === 'undefined') return base;
  if (!base || base === 'same-origin') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  const absolute = base.startsWith('http') || base.startsWith('ws')
    ? base
    : `${window.location.origin}${base.startsWith('/') ? '' : '/'}${base}`;
  return absolute.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
};
