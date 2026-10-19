// Compile/config validation only: k6 inspect never opens application connections.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateApproval } from './safety.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zeaplay-k6-inspect-'));
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  const config = validateApproval({ environment: 'local', approvedBy: 'compile-validation-only', profiles: ['smoke'],
    runId: 'compile-only', isolationNonce: 'synthetic-compile-only-nonce-0000000000', expiresAt: new Date(Date.now()+3600000).toISOString(), target: 'http://127.0.0.1:1' },
  { ZEAPLAY_LOAD_ENABLED: 'I_APPROVE_ISOLATED_LOAD_TESTING' });
  fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ userId: `not-a-real-user-${i}`, accessToken: 'synthetic-compile-only' }))));
  const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '-v', `${root}:/workspace:ro`, '-v', `${directory}:/fixtures:ro`,
    '-e', 'ZEAPLAY_LOAD_ENABLED=I_APPROVE_ISOLATED_LOAD_TESTING', '-e', `ZEAPLAY_LOAD_CONFIG=${JSON.stringify(config)}`,
    '-e', 'ZEAPLAY_LOAD_ACCOUNTS_FILE=/fixtures/accounts.json', 'grafana/k6:1.6.0', 'inspect', '--include-system-env-vars', '/workspace/benchmarks/realtime/native.js'],
  { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0 || result.error) process.exitCode = 1;
} finally {
  fs.unlinkSync(path.join(directory, 'accounts.json'));
  fs.rmdirSync(directory);
}
