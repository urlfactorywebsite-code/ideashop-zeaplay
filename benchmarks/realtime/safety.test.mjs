import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedURL, validateApproval, safetySample, preflightIsolation } from './safety.mjs';

const now = Date.parse('2026-10-15T00:00:00Z');
const approval = { environment: 'local', target: 'http://127.0.0.1:6300', approvedBy: 'local-test-owner', runId: 'synthetic-unit', isolationNonce: 'synthetic-unit-isolation-proof-000000', profiles: ['smoke', 'high'], expiresAt: '2026-10-15T01:00:00Z' };
const enabled = { ZEAPLAY_LOAD_ENABLED: 'I_APPROVE_ISOLATED_LOAD_TESTING' };
test('default disabled, validation does not connect to a target', () => {
  assert.throws(() => validateApproval(approval, {}, now), /disabled/);
  assert.equal(validateApproval(approval, enabled, now).users, 10);
});
test('production, redirects, DNS aliases, malformed and credentialed origins are rejected', () => {
  for (const url of ['http://167.86.108.178:6300', 'http://public.example', 'http://127.0.0.1.evil.example',
    'http://user:secret@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1?next=production', 'file:///tmp/x', 'http://169.254.169.254']) assert.throws(() => approvedURL(url));
  for (const url of ['http://localhost:6300', 'http://10.2.3.4', 'https://192.168.5.6', 'http://[::1]:6300']) assert.ok(approvedURL(url));
});
test('approval expiry, environment, higher profile, ceilings and weights fail closed', () => {
  assert.throws(() => validateApproval({ ...approval, environment: 'production' }, enabled, now));
  assert.throws(() => validateApproval(approval, enabled, now + 7200000));
  assert.throws(() => validateApproval(approval, { ...enabled, LOAD_PROFILE: 'high' }, now));
  for (const update of [{ LOAD_SESSIONS_PER_USER: '4' }, { LOAD_MAX_USERS: '5' }, { LOAD_SECONDS: '1000' },
    { LOAD_EVENT_RATE: '100' }, { LOAD_MAX_SECONDS: 'NaN' }, { LOAD_SCENARIO: 'arbitrary' }]) assert.throws(() => validateApproval(approval, { ...enabled, ...update }, now));
  assert.throws(() => validateApproval({ ...approval, weights: { chat: 99 } }, enabled, now));
  assert.equal(validateApproval(approval, { ...enabled, LOAD_PROFILE: 'high', ZEAPLAY_LOAD_HIGHER_APPROVAL: 'APPROVE_HIGH', LOAD_MAX_USERS: '250', LOAD_MAX_CONNECTIONS: '250', LOAD_WATCHDOG_FILE: 'operator-sampler.json' }, now).users, 250);
});
test('resource watchdog rejects stale, missing and unsafe measurements', () => {
  const sample = { timestamp: now, cpuFraction: .5, memoryFraction: .5, errorFraction: 0, outboxOldestSeconds: 0 };
  assert.ok(safetySample(sample, now));
  assert.equal(safetySample({ ...sample, cpuFraction: .95 }, now), false);
  assert.equal(safetySample({ ...sample, errorFraction: NaN }, now), false);
  assert.equal(safetySample(sample, now + 16000), false);
});

test('private address without a matching live isolation proof cannot open a load run', async () => {
  const config = { ...validateApproval(approval, enabled, now), expiresAt: new Date(Date.now()+100000).toISOString(), requestRate: 1000 };
  const account = { userId: 'synthetic-a', tenantId: 'tenant-a', conversationId: 'conversation', taskId: 'task', ticketId: 'ticket', accessToken: 'synthetic-only' };
  await assert.rejects(preflightIsolation(config, [account], 'native', async () => ({ ok: false })), /prove isolated/);
  const proof = { runId: config.runId, nonce: config.isolationNonce, outboundDeliveryBlocked: true, accounts: [account] };
  const fake = async url => ({ ok: true, json: async () => url.endsWith('/me') ? { id: account.userId, tenant_id: account.tenantId } : proof });
  await preflightIsolation(config, [account], 'native', fake);
  await assert.rejects(preflightIsolation(config, [{ ...account, tenantId: 'other' }], 'native', fake), /outside/);
  await assert.rejects(preflightIsolation(config, [account], 'native', async url => ({ ok: true, json: async () => url.endsWith('/me') ? { id: 'wrong', tenant_id: 'tenant-a' } : proof })), /identity/);
});
