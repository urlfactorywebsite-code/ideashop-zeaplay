import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KanbanPreview from '../components/KanbanPreview';
import KanbanColumnFrame from '../components/KanbanColumnFrame';
import { defaultArrangement, groupKanbanTasks, moveStatus, onBoard, sampleQuests, type StatusConfiguration } from '../utils/kanbanConfiguration';

const status = (id: string, overrides: Partial<StatusConfiguration> = {}): StatusConfiguration => ({
  id, code: id, system_name: id, display_label: id, description: 'Retained description',
  color: '#123abc', icon: 'flag', is_system: false, is_active: true, kanban_visible: true,
  sort_order: 0, legacy_status: null, task_count: 999, ...overrides,
});

test('visibility retains protected systems and excludes inactive or hidden custom statuses', () => {
  assert.equal(onBoard(status('system', { is_system: true, kanban_visible: false })), true);
  assert.equal(onBoard(status('hidden', { kanban_visible: false })), false);
  assert.equal(onBoard(status('archived', { is_active: false })), false);
  assert.equal(onBoard(status('custom')), true);
});

test('reordering preserves references and does not mutate the saved arrangement', () => {
  const saved = [status('A'), status('B'), status('C')];
  const moved = moveStatus(saved, 0, 2);
  assert.deepEqual(moved.map(row => row.id), ['B', 'C', 'A']);
  assert.deepEqual(saved.map(row => row.id), ['A', 'B', 'C']);
  assert.equal(moved[2], saved[0]);
  assert.equal(moveStatus(saved, 0, -1), saved);
  assert.equal(moveStatus(saved, 0, 0), saved);
});

test('reset stages presentation defaults without changing identities, activation or business fields', () => {
  const custom = status('custom', { system_name: 'Review', display_label: 'Customer review', is_active: false, default_sort_order: 11 });
  const core = status('core-id', { code: 'BATTLE_PLAN', is_system: true, legacy_status: 'WAITING_FOR_REQUIREMENT',
    system_name: 'Battle Plan', display_label: 'Planning', default_display_label: 'Battle Plan', default_sort_order: 0,
    default_color: '#aabbcc', default_icon: 'default', kanban_visible: false });
  const result = defaultArrangement([custom, core]);
  assert.deepEqual(result.map(row => row.id), ['core-id', 'custom']);
  assert.equal(result[0].display_label, 'Battle Plan');
  assert.equal(result[0].legacy_status, 'WAITING_FOR_REQUIREMENT');
  assert.equal(result[0].code, 'BATTLE_PLAN');
  assert.equal(result[0].color, '#aabbcc');
  assert.equal(result[0].kanban_visible, true);
  assert.equal(result[1].display_label, 'Review');
  assert.equal(result[1].is_active, false);
  assert.equal(result[1].description, custom.description);
  assert.equal(core.display_label, 'Planning');
});

test('preview uses draft order, labels and accents with synthetic tasks and empty columns', () => {
  const html = renderToStaticMarkup(<KanbanPreview statuses={[
    status('first', { display_label: 'First expedition' }), status('second'), status('third'),
    status('secret', { kanban_visible: false }), status('inactive', { is_active: false }),
  ]} disabled={false} onMove={() => {}} />);
  assert.ok(html.indexOf('data-preview-status="first"') < html.indexOf('data-preview-status="second"'));
  assert.match(html, /First expedition/);
  assert.match(html, /#123abc/);
  assert.match(html, /Scout the crystal caverns/);
  assert.match(html, /Drop quests here/);
  assert.match(html, /Desktop preview/);
  assert.match(html, /Compact preview/);
  assert.doesNotMatch(html, /data-preview-status="secret"|data-preview-status="inactive"|999/);
  assert.equal(sampleQuests(2).length, 0);
});

test('shared production frame renders arbitrary registered identity, full count and safe label text', () => {
  const html = renderToStaticMarkup(<KanbanColumnFrame statusKey="tenant-status-id" label={'Review <script>'}
    color="#ab1234" icon="star" count={115}><p>Quest card</p></KanbanColumnFrame>);
  assert.match(html, /115 tasks/);
  assert.match(html, /Review &lt;script&gt;/);
  assert.match(html, /Quest card/);
  assert.match(html, /#ab1234/);
  assert.doesNotMatch(html, /Add Stage/);
});

test('card grouping uses internal keys and retains every card once across custom and legacy states', () => {
  const tasks = [{ id: 'one', status: 'IN_PROGRESS', customStatusId: 'custom-id' },
    { id: 'two', status: 'IN_PROGRESS' }, { id: 'three', status: 'IN_PROGRESS', customStatusId: 'custom-id' }];
  const grouped = groupKanbanTasks(tasks);
  assert.deepEqual(grouped.get('custom-id')?.map(task => task.id), ['one', 'three']);
  assert.deepEqual(grouped.get('IN_PROGRESS')?.map(task => task.id), ['two']);
  assert.equal([...grouped.values()].flat().length, tasks.length);
});
