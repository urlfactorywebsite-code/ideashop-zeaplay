import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusLabels } from '../utils/taskStatusLabels';
import { CUSTOM_STATUS_NAMES, TaskStatus } from '../types';

test('renamed core display names resolve from immutable native keys', () => {
  const entries = [{ id: 'WAITING_FOR_REQUIREMENT', title: 'Ready Quests', order: 0 },
    { id: 'DONE', title: 'Victory', order: 1 }];
  const label = createStatusLabels(entries);
  assert.equal(label(TaskStatus.WAITING_FOR_REQUIREMENT), 'Ready Quests');
  assert.equal(label(TaskStatus.DONE, null, 'Outdated card label'), 'Victory');
  assert.equal(entries[0].id, 'WAITING_FOR_REQUIREMENT');
  assert.equal(CUSTOM_STATUS_NAMES[TaskStatus.DONE].name, 'Conquered');
});

test('hidden and inactive names remain readable and custom legacy aliases resolve', () => {
  const label = createStatusLabels([{ id:'BUG_FIXING', title:'Quality Check', order:0, is_active:false, kanban_visible:false },
    { id:'old-column-id', custom_status_id:'immutable-custom-id', title:'Client Review', order:1 }]);
  assert.equal(label('BUG_FIXING'), 'Quality Check');
  assert.equal(label('old-column-id'), 'Client Review');
  assert.equal(label('IN_PROGRESS','immutable-custom-id'), 'Client Review');
  assert.equal(label('IN_PROGRESS','deleted-custom-id','Historical Review'), 'Historical Review');
  assert.equal(label('IN_PROGRESS','unmapped-custom-id'), 'unmapped-custom-id');
});

test('tenant catalogs are independent and updates do not mutate previous snapshots', () => {
  const entries = [{ id:'IN_PROGRESS', title:'Guild A', order:0 }];
  const a = createStatusLabels(entries);
  const b = createStatusLabels([{ id:'IN_PROGRESS', title:'Guild B', order:0 }]);
  entries[0].title = 'Guild A revised';
  assert.equal(a('IN_PROGRESS'), 'Guild A');
  assert.equal(b('IN_PROGRESS'), 'Guild B');
  assert.equal(createStatusLabels(entries)('IN_PROGRESS'), 'Guild A revised');
  assert.equal(createStatusLabels()('IN_PROGRESS'), 'In Progress');
});

test('labels preserve Unicode and long values while unknown records keep a readable fallback', () => {
  const name = 'Quality — 测试 ' + 'L'.repeat(60);
  const label = createStatusLabels([{ id:'BUG_FIXING', title:name, order:0 }]);
  assert.equal(label('BUG_FIXING'), name);
  assert.equal(label('UNKNOWN_STATUS'), 'UNKNOWN STATUS');
  assert.equal(label('UNKNOWN_STATUS', null, 'Imported stage'), 'Imported stage');
});
