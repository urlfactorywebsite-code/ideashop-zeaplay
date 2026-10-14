import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const logsSource = readFileSync(new URL('../pages/Logs.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('audit logs page keeps existing API contracts while using the redesigned dashboard', () => {
  assert.match(logsSource, /api\.getAuditLogs/);
  assert.match(logsSource, /api\.exportAuditLogs/);
  assert.match(logsSource, /api\.getAuditRetention/);
  assert.match(logsSource, /api\.updateAuditRetention/);
  assert.match(logsSource, /api\.applyAuditRetention/);
  assert.match(logsSource, /api\.retryAuditLog/);

  assert.match(logsSource, /Audit Logs/);
  assert.match(logsSource, /Monitor user activity, system events, and security actions\./);
  assert.match(logsSource, /Search current page/);
  assert.match(logsSource, /Advanced Filters/);
  assert.match(logsSource, /Retention Settings/);
  assert.match(logsSource, /Event Overview/);
  assert.match(logsSource, /Structured JSON View/);
});

test('audit logs redesign includes compact tabs, popover filters and safer details rendering', () => {
  assert.match(logsSource, /All Logs/);
  assert.match(logsSource, /Failed Only/);
  assert.match(logsSource, /MultiSelectFilter/);
  assert.match(logsSource, /Select all/);
  assert.match(logsSource, /No logs match your current filters\./);
  assert.match(logsSource, /No audit logs found\./);
  assert.match(logsSource, /SENSITIVE_KEY_PATTERN/);
  assert.match(logsSource, /requestIdRef/);
  assert.match(logsSource, /statusLocked \? tabFilter\.status : filters\.status/);
  assert.match(logsSource, /Locked by Failed Only\./);
  assert.match(logsSource, /closeRetentionModal/);

  assert.match(cssSource, /\.audit-dashboard/);
  assert.match(cssSource, /\.audit-tab-active/);
  assert.match(cssSource, /\.audit-popover/);
  assert.match(cssSource, /\.audit-change-summary/);
  assert.doesNotMatch(cssSource, /log-arcade/);
  assert.match(cssSource, /prefers-reduced-motion/);
});
