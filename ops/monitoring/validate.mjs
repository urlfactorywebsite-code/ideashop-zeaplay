// Configuration validation only. Never starts app services or runs a load profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zeaplay-monitor-config-'));
const credential = path.join(directory, 'metrics_token');
fs.writeFileSync(credential, 'synthetic-config-validation-not-a-secret-0000\n', { mode: 0o600 });
let failed = false;
function run(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
  if (result.status !== 0 || result.error) failed = true;
}
try {
  const volume = `${path.join(root, 'ops/monitoring')}:/etc/prometheus:ro`;
  for (const args of [['check', 'config', '/etc/prometheus/prometheus.yml'], ['check', 'rules', '/etc/prometheus/alerts.yml'], ['test', 'rules', '/etc/prometheus/alerts.test.yml']]) {
    run(['run', '--rm', '--entrypoint', 'promtool', '-w', '/etc/prometheus', '-v', volume, '-v', `${credential}:/run/secrets/metrics_token:ro`, 'prom/prometheus:v3.2.1', ...args]);
  }
  const dashboards = path.join(root, 'ops/monitoring/grafana/dashboards');
  const rules = fs.readdirSync(dashboards).filter(name => name.endsWith('.json')).flatMap(name =>
    JSON.parse(fs.readFileSync(path.join(dashboards, name), 'utf8')).panels.flatMap(panel => panel.targets.map(target => target.expr)));
  const dashboardRules = path.join(directory, 'dashboard-rules.json');
  fs.writeFileSync(dashboardRules, JSON.stringify({ groups: [{ name: 'dashboard-query-validation', rules: rules.map((expr, i) => ({ record: `zea:test_panel_${i}`, expr })) }] }));
  run(['run', '--rm', '--entrypoint', 'promtool', '-v', `${dashboardRules}:/tmp/dashboard-rules.json:ro`, 'prom/prometheus:v3.2.1', 'check', 'rules', '/tmp/dashboard-rules.json']);
  run(['compose', '--env-file', '.env.production.example', '-f', 'docker-compose.prod.yml', '-f', 'docker-compose.monitoring.yml', 'config', '--quiet'], {
    env: { ...process.env, ZEAPLAY_ENV_FILE: '.env.production.example', ZEAPLAY_METRICS_TOKEN_FILE: credential,
      ZEAPLAY_GRAFANA_PASSWORD_FILE: credential, ZEAPLAY_POSTGRES_MONITOR_DSN_FILE: credential },
  });
} finally {
  if (fs.existsSync(path.join(directory, 'dashboard-rules.json'))) fs.unlinkSync(path.join(directory, 'dashboard-rules.json'));
  fs.unlinkSync(credential);
  fs.rmdirSync(directory);
}
if (failed) process.exitCode = 1;
