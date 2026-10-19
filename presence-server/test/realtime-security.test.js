import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('socket.io server keeps auth, cors and redis adapter wired', () => {
  assert.match(source, /io\.use\(authenticateSocket\)/);
  assert.match(source, /origin\(origin, callback\)/);
  assert.match(source, /requireOrigin: parseBool\(process\.env\.PRESENCE_REQUIRE_ORIGIN, false\)/);
  assert.match(source, /allowLocalhostOrigins: parseBool\(process\.env\.PRESENCE_ALLOW_LOCALHOST_ORIGINS, true\)/);
  assert.match(source, /maxConnectionsPerUser: Number\.parseInt\(process\.env\.PRESENCE_MAX_CONNECTIONS_PER_USER/);
  assert.match(source, /maxTotalConnections: Number\.parseInt\(process\.env\.PRESENCE_MAX_TOTAL_CONNECTIONS/);
  assert.match(source, /io\.adapter\(createAdapter\(pubClient, subClient\)\)/);
  assert.match(source, /server\.listen\(config\.port, '0\.0\.0\.0'/);
});

test('socket.io origin policy rejects missing and malformed origins when configured', () => {
  assert.match(source, /if \(!origin\) {\s*return !config\.requireOrigin;\s*}/s);
  assert.match(source, /function normalizeOrigin\(origin\)/);
  assert.match(source, /if \(!normalizedOrigin\) {\s*return false;\s*}/s);
  assert.match(source, /allowedOrigins\.has\(normalizedOrigin\)/);
});

test('call signaling events remain registered', () => {
  assert.match(source, /const on = instrument\(socket\)/);
  for (const eventName of ['call:initiate', 'call:answer', 'call:candidate', 'call:reject', 'call:end']) {
    assert.match(source, new RegExp(`on\\('${eventName}'`));
  }
});

test('rooms are tenant scoped for chat, calls and meetings', () => {
  assert.match(source, /function buildUserRoom\(tenantId, userId\)/);
  assert.match(source, /function buildChatRoom\(tenantId, spaceId\)/);
  assert.match(source, /function buildMeetingRoom\(tenantId, meetingId\)/);
  assert.match(source, /tenant:\$\{tenantId\}:user:\$\{userId\}/);
  assert.match(source, /tenant:\$\{tenantId\}:chat:\$\{spaceId\}/);
  assert.match(source, /tenant:\$\{tenantId\}:meeting:\$\{meetingId\}/);
  assert.doesNotMatch(source, /buildUserRoom\(recipientId\)/);
  assert.doesNotMatch(source, /buildMeetingRoom\(meetingId\)/);
});

test('meeting cleanup remains registered on disconnect', () => {
  assert.match(source, /socket\.on\('disconnect'/);
  assert.match(source, /leaveMeetingRoom\(socket, meetingId\)/);
  assert.match(source, /await markOffline\(socket\)/);
});
