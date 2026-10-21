import assert from 'node:assert/strict';
import test from 'node:test';
import { getApiBaseUrl, getSocketApiBaseUrl, readEndpoint } from '../services/endpoints';
import { resolvePresenceSocketUrl, toWebSocketBaseUrl } from '../services/realtimeAuth';

const frontend = 'https://ideashop.zeacrm.com';
const api = 'https://api.ideashop.zeacrm.com';

test('unconfigured local clients use same-origin API and local presence', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'http://localhost:6300', hostname: 'localhost', host: 'localhost:6300', protocol: 'http:' },
  } });
  assert.equal(getApiBaseUrl(), '/api');
  assert.equal(toWebSocketBaseUrl(getSocketApiBaseUrl()), 'ws://localhost:6300/api');
  assert.equal(resolvePresenceSocketUrl(), 'http://localhost:6312');
});

test('production runtime directs REST, OAuth, tickets and chat to the API host', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: frontend, hostname: 'ideashop.zeacrm.com', host: 'ideashop.zeacrm.com', protocol: 'https:' },
    __RUNTIME_CONFIG__: { API_URL: api + '/api/', PRESENCE_URL: api },
  } });
  assert.equal(getApiBaseUrl(), api + '/api');
  assert.equal(getApiBaseUrl() + '/oauth2/clients', api + '/api/oauth2/clients');
  assert.equal(toWebSocketBaseUrl(getSocketApiBaseUrl()) + '/ws/chat', 'wss://api.ideashop.zeacrm.com/api/ws/chat');
  assert.equal(toWebSocketBaseUrl(getSocketApiBaseUrl(true)), 'wss://api.ideashop.zeacrm.com/api');
  assert.equal(resolvePresenceSocketUrl(), api);
});

test('runtime WebSocket overrides and same-origin presence are respected', () => {
  Object.assign((globalThis as any).window.__RUNTIME_CONFIG__, {
    WS_URL: 'wss://api.ideashop.zeacrm.com/api',
    TICKET_CHAT_WS_URL: 'wss://api.ideashop.zeacrm.com/api/', PRESENCE_URL: 'same-origin',
  });
  assert.equal(toWebSocketBaseUrl(getSocketApiBaseUrl(true)), 'wss://api.ideashop.zeacrm.com/api');
  assert.equal(resolvePresenceSocketUrl(), frontend);
});

test('blank runtime values fall back without producing empty API paths', () => {
  (globalThis as any).window.__RUNTIME_CONFIG__ = { API_URL: '  ', PRESENCE_URL: '', CHAT_URL: api };
  assert.equal(getApiBaseUrl(), '/api');
  assert.equal(readEndpoint('WS_URL', '/api'), '/api');
  assert.equal(resolvePresenceSocketUrl(), api);
});
