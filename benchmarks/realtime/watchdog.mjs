// Read-only Prometheus resource sampler. Run separately before an approved load run.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { approvedURL, validateApproval } from './safety.mjs';

const approval = JSON.parse(fs.readFileSync(process.env.ZEAPLAY_LOAD_APPROVAL_FILE, 'utf8'));
const config = validateApproval(approval);
const origin = approvedURL(approval.monitorTarget);
const destination = process.env.LOAD_WATCHDOG_FILE;
if (!destination || !destination.endsWith('.watchdog.local.json')) throw new Error('Use an explicit .watchdog.local.json output path');
async function query(expression) {
  const response = await fetch(`${origin}/api/v1/query?query=${encodeURIComponent(expression)}`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Resource query failed');
  const result = await response.json();
  if (result.status !== 'success' || result.data?.result?.length !== 1) throw new Error('Resource metric is absent or ambiguous');
  const value = Number(result.data.result[0].value[1]);
  if (!Number.isFinite(value)) throw new Error('Invalid resource metric');
  return value;
}
while (Date.now() < Date.parse(config.expiresAt)) {
  if (await query('count(count by(job)(up{job=~"fastapi|presence|redis|postgres|host"}))') !== 5 ||
      await query('min(up{job=~"fastapi|presence|redis|postgres|host"})') !== 1) throw new Error('Monitoring targets are not healthy');
  for (const expression of ['min(zea_dependency_up{job="fastapi"})', 'min(redis_up)', 'min(pg_up)', 'min(zea_io_redis_up)', 'min(zea_rt_subscriber_up)']) {
    if (await query(expression) !== 1) throw new Error('Application dependency is not healthy');
  }
  if (await query('max(time()-zea_dependency_sample_timestamp_seconds)') > 90) throw new Error('Application dependency probe is stale');
  const outboxEnabled = await query('max(zea_outbox_enabled)');
  const sample = {
    cpuFraction: await query('max(1-avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[1m])))'),
    memoryFraction: await query('max(1-node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)'),
    errorFraction: await query('(sum(rate(zea_rt_events_total{outcome=~"publish_error|processing_error"}[1m])) or vector(0)) / clamp_min((sum(rate(zea_rt_events_total{outcome=~"processed|publish_error|processing_error"}[1m])) or vector(0)),0.000001)'),
    outboxOldestSeconds: outboxEnabled === 1 ? await query('max(zea_outbox_oldest_seconds)') : 0,
    timestamp: Date.now(),
  };
  fs.writeFileSync(destination + '.tmp', JSON.stringify(sample), { mode: 0o600 });
  fs.renameSync(destination + '.tmp', destination);
  await sleep(5000);
}
