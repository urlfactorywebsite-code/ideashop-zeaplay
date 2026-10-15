import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RealtimeReconnectController, calculateReconnectDelay } from '../services/realtimeBackoff';

const sharedSocketSource = readFileSync(new URL('../services/sharedSocketIo.ts', import.meta.url), 'utf8');
const presenceHookSource = readFileSync(new URL('../hooks/usePresence.ts', import.meta.url), 'utf8');
const callsHookSource = readFileSync(new URL('../features/chat/hooks/useNexusCalls.ts', import.meta.url), 'utf8');
const chatRealtimeSource = readFileSync(new URL('../features/chat/hooks/useChatRealtime.ts', import.meta.url), 'utf8');
const taskSocketSource = readFileSync(new URL('../hooks/useTaskWebSocket.ts', import.meta.url), 'utf8');
const ticketSocketSource = readFileSync(new URL('../hooks/useTicketChat.ts', import.meta.url), 'utf8');
const tasksPageSource = readFileSync(new URL('../pages/Tasks.tsx', import.meta.url), 'utf8');
const presenceServerSource = readFileSync(new URL('../../presence-server/src/server.js', import.meta.url), 'utf8');

test('presence and call hooks share one Socket.IO lease per auth context', () => {
  assert.match(sharedSocketSource, /const sharedSockets = new Map/);
  assert.match(sharedSocketSource, /refs \+= 1/);
  assert.match(sharedSocketSource, /SHARED_SOCKET_RELEASE_DELAY_MS/);
  assert.match(sharedSocketSource, /tokenFingerprint/);
  assert.match(sharedSocketSource, /socket\.off\(eventName, handler\)/);

  assert.match(presenceHookSource, /acquireSharedPresenceSocket\(user\.id\)/);
  assert.match(callsHookSource, /acquireSharedPresenceSocket\(currentUser\.id\)/);
  assert.match(callsHookSource, /lease\.emit\('call:end'/);
  assert.match(callsHookSource, /lease\.emit\('meeting:leave'/);
  assert.match(callsHookSource, /stopMediaTracks\(\)/);
  assert.doesNotMatch(presenceHookSource, /io\(/);
  assert.doesNotMatch(callsHookSource, /io\(/);
});

test('native websocket hooks use bounded jittered reconnect and cleanup', () => {
  assert.equal(calculateReconnectDelay(0, { minDelayMs: 1000, maxDelayMs: 10000, jitterRatio: 0 }, () => 0.5), 1000);
  assert.equal(calculateReconnectDelay(2, { minDelayMs: 1000, maxDelayMs: 10000, jitterRatio: 0 }, () => 0.5), 4000);
  assert.ok(calculateReconnectDelay(8, { minDelayMs: 1000, maxDelayMs: 5000, jitterRatio: 0 }, () => 0.5) <= 5000);

  for (const source of [chatRealtimeSource, taskSocketSource, ticketSocketSource]) {
    assert.match(source, /RealtimeReconnectController/);
    assert.match(source, /\.cancel\(\)/);
    assert.match(source, /event\.code === 1008/);
  }
});

test('offline reconnect scheduling does not accumulate online listeners', () => {
  const globalScope = globalThis as any;
  const originalWindow = globalScope.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const onlineListeners = new Set<() => void>();

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  globalScope.window = {
    addEventListener(eventName: string, handler: () => void) {
      if (eventName === 'online') onlineListeners.add(handler);
    },
    removeEventListener(eventName: string, handler: () => void) {
      if (eventName === 'online') onlineListeners.delete(handler);
    },
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
  };

  try {
    let callbacks = 0;
    const controller = new RealtimeReconnectController();
    controller.schedule(() => {
      callbacks += 1;
    });
    controller.schedule(() => {
      callbacks += 1;
    });

    assert.equal(onlineListeners.size, 1);
    Array.from(onlineListeners)[0]?.();
    assert.equal(callbacks, 1);
    controller.cancel();
  } finally {
    if (originalWindow === undefined) {
      delete globalScope.window;
    } else {
      globalScope.window = originalWindow;
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete globalScope.navigator;
    }
  }
});

test('event handling is debounced or deduplicated where safe', () => {
  assert.match(tasksPageSource, /realtimeRefreshTimerRef/);
  assert.match(tasksPageSource, /window\.setTimeout\(flushRealtimeTaskRefresh, 250\)/);

  assert.match(ticketSocketSource, /message\.comment\.id === parsed\.comment\.id/);
  assert.match(ticketSocketSource, /\.slice\(-200\)/);
});

test('presence server exposes configurable connection limits', () => {
  assert.match(presenceServerSource, /PRESENCE_MAX_CONNECTIONS_PER_USER/);
  assert.match(presenceServerSource, /PRESENCE_MAX_TOTAL_CONNECTIONS/);
  assert.match(presenceServerSource, /exceedsConnectionLimits/);
  assert.match(presenceServerSource, /presence:error/);
});
