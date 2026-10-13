import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('push notifications do not use the SPA fallback as icon or badge', () => {
  assert.equal(swSource.includes('/favicon.ico'), false);
  assert.match(swSource, /typeof payload\.icon === 'string'/);
  assert.match(swSource, /typeof payload\.badge === 'string'/);
});

test('push notification display failures are logged by the service worker', () => {
  assert.match(swSource, /showNotification\(title, options\)\.catch/);
  assert.match(swSource, /Unable to display push notification/);
});
