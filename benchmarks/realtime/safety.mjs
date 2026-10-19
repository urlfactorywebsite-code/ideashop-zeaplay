import fs from 'node:fs';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const profiles = Object.freeze({ smoke: 10, baseline: 25, small: 50, medium: 100, high: 250, stress: 500, extended: 1000 });
export const scenarios = new Set(['idle', 'chat', 'tasks', 'tickets', 'mixed', 'reconnect', 'cross-worker', 'redis-recovery', 'shutdown']);
function integer(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
export function approvedURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Target must be an origin only');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Literal private addresses only: no DNS rebind, redirect, or public production target.
  const parts = host.split('.').map(Number);
  const private4 = net.isIP(host) === 4 && (parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
  if (!(private4 || host === 'localhost' || host === '::1')) throw new Error('Only explicitly approved loopback/private literal targets are supported');
  return url.origin;
}
export function validateApproval(approval, env = process.env, now = Date.now()) {
  if (env.ZEAPLAY_LOAD_ENABLED !== 'I_APPROVE_ISOLATED_LOAD_TESTING') throw new Error('Load testing is disabled');
  const profile = env.LOAD_PROFILE || 'smoke';
  if (!Object.hasOwn(profiles, profile) || !Array.isArray(approval.profiles) || !approval.profiles.includes(profile)) throw new Error('Profile not approved');
  if (profile !== 'smoke' && env.ZEAPLAY_LOAD_HIGHER_APPROVAL !== `APPROVE_${profile.toUpperCase()}`) throw new Error('Higher profile requires separate approval');
  const expiry = Date.parse(approval.expiresAt);
  if (!['local', 'staging'].includes(approval.environment) || !approval.approvedBy || !approval.runId || !Number.isFinite(expiry) || expiry <= now || expiry - now > 86400000) throw new Error('Approval missing, expired, or exceeds 24 hours');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(approval.runId) || String(approval.approvedBy).length > 128) throw new Error('Invalid approval metadata');
  const target = approvedURL(approval.target);
  const presenceTarget = approvedURL(approval.presenceTarget || approval.target);
  const origin = approvedURL(approval.origin || approval.target);
  const workerTargets = (approval.workerTargets || [target]).map(approvedURL);
  const presenceTargets = (approval.presenceTargets || [presenceTarget]).map(approvedURL);
  if (workerTargets.length > 8 || presenceTargets.length > 8 || !workerTargets.length || !presenceTargets.length) throw new Error('Invalid approved target count');
  const maxUsers = integer(env.LOAD_MAX_USERS, 10, 1, 2000, 'user ceiling');
  const users = profile === 'smoke' ? integer(env.LOAD_SMOKE_USERS, 10, 1, 10, 'smoke users') : profile === 'extended' ? integer(env.LOAD_EXTENDED_USERS, 1000, 1000, 2000, 'extended users') : profiles[profile];
  const sessions = integer(env.LOAD_SESSIONS_PER_USER, 1, 1, 4, 'sessions per user');
  const maxConnections = integer(env.LOAD_MAX_CONNECTIONS, 20, 1, 8000, 'connection ceiling');
  const maxSeconds = integer(env.LOAD_MAX_SECONDS, 120, 40, 3600, 'duration ceiling');
  const seconds = integer(env.LOAD_SECONDS, 60, 10, 3500, 'sustained duration');
  const eventRate = integer(env.LOAD_EVENT_RATE, 5, 1, 1000, 'event rate');
  const maxEventRate = integer(env.LOAD_MAX_EVENT_RATE, 10, 1, 1000, 'event rate ceiling');
  const requestRate = integer(env.LOAD_REQUEST_RATE, 10, 1, 1000, 'request rate');
  const maxRequestRate = integer(env.LOAD_MAX_REQUEST_RATE, 20, 1, 1000, 'request rate ceiling');
  if (users > maxUsers || users * sessions > maxConnections || seconds + 40 > maxSeconds || eventRate > maxEventRate || requestRate > maxRequestRate) throw new Error('Requested workload exceeds ceiling');
  const scenario = env.LOAD_SCENARIO || 'idle';
  if (!scenarios.has(scenario)) throw new Error('Unsupported scenario');
  if (scenario === 'cross-worker' && (workerTargets.length < 2 || new Set(workerTargets).size < 2)) throw new Error('Cross-worker tests require two explicitly approved independent worker origins');
  if (profile !== 'smoke' && !env.LOAD_WATCHDOG_FILE) throw new Error('Higher profiles require a resource watchdog');
  const weights = approval.weights || { idle: 50, tasks: 20, chat: 15, tickets: 10, presence: 4, calls: 1 };
  const allowed = ['idle', 'tasks', 'chat', 'tickets', 'presence', 'calls'];
  if (Object.keys(weights).some(k => !allowed.includes(k)) || Object.values(weights).some(n => !Number.isInteger(n) || n < 0) || Object.values(weights).reduce((a,b) => a+b, 0) !== 100) throw new Error('Workload weights must total 100');
  if (typeof approval.isolationNonce !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(approval.isolationNonce)) throw new Error('An isolated deployment proof nonce is required');
  return { target, presenceTarget, origin, profile, users, sessions, seconds, maxSeconds, eventRate, requestRate,
    maxConnections, scenario, weights, workerTargets, presenceTargets, runId: approval.runId, expiresAt: approval.expiresAt,
    isolationNonce: approval.isolationNonce };
}

export function safetySample(sample, now = Date.now()) {
  if (!Number.isFinite(sample.timestamp) || now - sample.timestamp > 15000 || sample.timestamp > now + 1000) return false;
  for (const name of ['cpuFraction', 'memoryFraction', 'errorFraction', 'outboxOldestSeconds']) {
    if (!Number.isFinite(sample[name]) || sample[name] < 0) return false;
  }
  return sample.cpuFraction < 0.9 && sample.memoryFraction < 0.9 && sample.errorFraction < 0.05 && sample.outboxOldestSeconds < 60;
}

export function loadConfiguration(env = process.env) {
  if (!env.ZEAPLAY_LOAD_APPROVAL_FILE || !env.ZEAPLAY_LOAD_ACCOUNTS_FILE) throw new Error('Explicit approval and synthetic account files are required');
  const config = validateApproval(JSON.parse(fs.readFileSync(env.ZEAPLAY_LOAD_APPROVAL_FILE, 'utf8')), env);
  const accounts = JSON.parse(fs.readFileSync(env.ZEAPLAY_LOAD_ACCOUNTS_FILE, 'utf8'));
  if (!Array.isArray(accounts) || accounts.length < config.users || new Set(accounts.slice(0, config.users).map(a => a.userId)).size !== config.users) throw new Error('One distinct synthetic identity is required per user');
  for (const account of accounts.slice(0, config.users)) {
    if (!account.userId || !account.tenantId || typeof account.accessToken !== 'string' || !account.accessToken || account.synthetic !== true || !account.conversationId || !account.taskId || !account.ticketId) throw new Error('Incomplete synthetic fixture');
    for (const key of ['conversationId', 'taskId', 'ticketId', 'userId', 'tenantId']) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(account[key])) throw new Error('Unsafe fixture identifier');
    }
  }
  return { config, accounts: accounts.slice(0, config.users) };
}

export const fixtureIdentity = account => Object.fromEntries(['userId', 'tenantId', 'conversationId', 'taskId', 'ticketId'].map(key => [key, account[key]]));

export async function preflightIsolation(config, accounts, tool, fetchImpl = fetch) {
  const started = performance.now();
  async function request(url, options = {}) {
    if (Date.now() >= Date.parse(config.expiresAt) || performance.now() - started > Math.min(60000, config.maxSeconds * 1000)) throw new Error('Isolation preflight deadline exceeded');
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(3000) });
    await delay(Math.ceil(1000 / config.requestRate));
    return response;
  }
  const targets = [...new Set([config.target, ...config.workerTargets])];
  if (tool === 'socketio') targets.push(...config.presenceTargets.filter(target => !targets.includes(target)));
  for (const target of targets) {
    const response = await request(`${approvedURL(target)}/api/__test__/realtime-isolation`);
    if (!response.ok) throw new Error('Target did not prove isolated test ownership');
    const proof = await response.json();
    if (proof.runId !== config.runId || proof.nonce !== config.isolationNonce || proof.outboundDeliveryBlocked !== true || !Array.isArray(proof.accounts)) throw new Error('Invalid isolated deployment proof');
    for (const account of accounts) {
      const identity = fixtureIdentity(account);
      if (!proof.accounts.some(row => Object.entries(identity).every(([key, value]) => row[key] === value))) throw new Error('Fixture is outside the isolated deployment proof');
    }
  }
  for (const account of accounts) {
    const response = await request(`${config.target}/api/auth/me`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
    if (!response.ok) throw new Error('Synthetic account authentication failed');
    const identity = await response.json();
    if (identity.id !== account.userId || String(identity.tenant_id) !== account.tenantId) throw new Error('Credential identity/tenant does not match fixture');
  }
}
