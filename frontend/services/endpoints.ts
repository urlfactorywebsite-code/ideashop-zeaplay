/** Public deployment URLs. Runtime settings override image build settings. */
export type EndpointKey = 'API_URL' | 'PRESENCE_URL' | 'CHAT_URL' | 'WS_URL' | 'TICKET_CHAT_WS_URL';
export type EndpointConfig = Partial<Record<EndpointKey, string>>;

export const readEndpoint = (key: EndpointKey, fallback = ''): string => {
  const runtime = typeof window === 'undefined' ? undefined
    : (window as typeof window & { __RUNTIME_CONFIG__?: EndpointConfig }).__RUNTIME_CONFIG__;
  const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
  const compiled: EndpointConfig = {
    API_URL: env.VITE_API_URL || env.VITE_API_BASE_URL,
    PRESENCE_URL: env.VITE_PRESENCE_URL,
    CHAT_URL: env.VITE_CHAT_URL,
    WS_URL: env.VITE_WS_URL,
    TICKET_CHAT_WS_URL: env.VITE_TICKET_CHAT_WS_URL,
  };
  return [runtime?.[key], compiled[key], fallback].find(value => typeof value === 'string' && value.trim())?.trim() || '';
};

export const getApiBaseUrl = (): string => readEndpoint('API_URL', '/api').replace(/\/+$/, '');
export const getSocketApiBaseUrl = (tickets = false): string => {
  const base = readEndpoint('WS_URL', getApiBaseUrl());
  return tickets ? readEndpoint('TICKET_CHAT_WS_URL', base) : base;
};
