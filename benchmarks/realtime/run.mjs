import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfiguration, safetySample, preflightIsolation } from './safety.mjs';

// Validation is the default. --run is a second, explicit barrier.
const { config, accounts } = loadConfiguration();
const tool = process.argv[2] || 'native';
if (!['native', 'socketio'].includes(tool)) throw new Error('Select native or socketio');
const { isolationNonce, ...publicConfig } = config;
console.log(JSON.stringify({ validation: 'PASS', ...publicConfig, credentials: 'not printed', execution: process.argv.includes('--run') ? 'explicitly enabled' : 'NOT RUN' }));
if (process.argv.includes('--run')) {
  await preflightIsolation(config, accounts, tool);
  if (Date.now() >= Date.parse(config.expiresAt) || (process.env.LOAD_STOP_FILE && fs.existsSync(process.env.LOAD_STOP_FILE))) throw new Error('Approval expired or operator stop already requested');
  if (process.env.LOAD_WATCHDOG_FILE && !safetySample(JSON.parse(fs.readFileSync(process.env.LOAD_WATCHDOG_FILE, 'utf8')))) throw new Error('Resource watchdog preflight failed');
  const native = tool === 'native';
  const executable = native ? (process.env.K6_BINARY || 'k6') : process.execPath;
  const script = fileURLToPath(new URL(native ? './native.js' : './socketio.mjs', import.meta.url));
  const args = native ? ['run', '--summary-export', process.env.LOAD_SUMMARY_FILE || 'realtime-summary.json', script] : [script];
  const child = spawn(executable, args, { windowsHide: true, stdio: 'inherit', env: { ...process.env, ZEAPLAY_LOAD_CONFIG: JSON.stringify(config) } });
  let forced = false;
  let escalation;
  const stop = () => {
    if (forced) return;
    forced = true; child.kill('SIGTERM');
    escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
  };
  const deadline = setTimeout(stop, config.maxSeconds * 1000);
  const watchdog = setInterval(() => {
    if (Date.now() >= Date.parse(config.expiresAt) || (process.env.LOAD_STOP_FILE && fs.existsSync(process.env.LOAD_STOP_FILE))) stop();
    if (process.env.LOAD_WATCHDOG_FILE) {
      try { if (!safetySample(JSON.parse(fs.readFileSync(process.env.LOAD_WATCHDOG_FILE, 'utf8')))) stop(); }
      catch { stop(); }
    }
  }, 500);
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, stop);
  child.on('error', () => { console.error('Harness could not start; verify local tool installation'); clearTimeout(deadline); clearInterval(watchdog); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(deadline); clearTimeout(escalation); clearInterval(watchdog); process.exitCode = forced ? 1 : code ?? 1; });
}
