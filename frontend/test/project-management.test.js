import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProjectIds, toProjectPayload, validateProjectDraft } from '../utils/projectValidation.ts';

test('project validation requires client and an active manager selection', () => {
  const errors = validateProjectDraft({
    name: 'A',
    clientId: '',
    description: '',
    startDate: '2026-10-15',
    endDate: '2026-10-14',
    managerIds: [],
    memberIds: ['user-1'],
  });

  assert.match(errors.name ?? '', /at least 2/);
  assert.match(errors.clientId ?? '', /Select a client/);
  assert.match(errors.managerIds ?? '', /manager/);
  assert.match(errors.dates ?? '', /End date/);
});

test('project payload de-duplicates users and keeps managers authoritative', () => {
  assert.deepEqual(normalizeProjectIds([' manager-1 ', 'manager-1', '', 'member-1']), ['manager-1', 'member-1']);

  const payload = toProjectPayload({
    name: '  Enterprise Rollout ',
    clientId: ' client-1 ',
    description: '  Launch plan  ',
    startDate: '2026-10-15',
    endDate: '',
    managerIds: ['manager-1', 'manager-1'],
    memberIds: ['member-1', 'manager-1'],
  });

  assert.deepEqual(payload, {
    name: 'Enterprise Rollout',
    clientId: 'client-1',
    description: 'Launch plan',
    startDate: '2026-10-15',
    endDate: null,
    managerIds: ['manager-1'],
    memberIds: ['member-1'],
  });
});
