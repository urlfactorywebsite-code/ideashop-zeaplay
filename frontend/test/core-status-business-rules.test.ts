import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTaskDeadline, isTaskOverdue } from '../utils/taskDeadlines';
import { calculateTaskPoints } from '../utils/taskPoints';
import { TaskStatus, TaskPriority, type Task } from '../types';

const task = (overrides: Partial<Task> = {}) => ({id:'quest',title:'Guild quest',team:'Engineering',priority:TaskPriority.MEDIUM,
  status:TaskStatus.IN_PROGRESS,dueAt:'2026-01-01T12:00:00',createdAt:'2026-01-01T10:00:00',assignedTo:[],subtasks:[],...overrides} as Task);
const instant=(value:string)=>Date.parse(value+'Z');
const config={Engineering:{[TaskPriority.MEDIUM]:{base:100,beforeDueBonus:20,overduePenalty:-10}}} as any;

test('authorized multi-day hold freezes eligible age while preserving original deadline',()=>{
  const held=task({status:TaskStatus.ON_HOLD,holdStartedAt:'2026-01-01T10:00:00',holdPausedSeconds:3600});
  const now=instant('2026-01-04T10:00:00');
  assert.equal(effectiveTaskDeadline(held,now),instant('2026-01-04T13:00:00'));
  assert.equal(isTaskOverdue(held,now),false);
  assert.equal(held.dueAt,'2026-01-01T12:00:00');
  assert.equal(calculateTaskPoints(held,config,new Date(now)).totalAwarded,0);
});

test('hold preserves lateness incurred before hold and awards no new penalty or completion points',()=>{
  const held=task({status:TaskStatus.ON_HOLD,dueAt:'2026-01-01T09:00:00',holdStartedAt:'2026-01-01T10:00:00'});
  const now=instant('2026-01-05T10:00:00');
  assert.equal(now-effectiveTaskDeadline(held,now)!,3600_000);
  assert.equal(isTaskOverdue(held,now),true);
  const points=calculateTaskPoints(held,config,new Date(now));
  assert.equal(points.totalAwarded,0);
  assert.match(points.notes.join(' '),/Authorized hold time/);
});

test('resumed completion uses accumulated holds with unchanged reward and penalty configuration',()=>{
  const resumed=task({holdPausedSeconds:3*86400});
  const now=instant('2026-01-04T11:00:00');
  assert.equal(isTaskOverdue(resumed,now),false);
  assert.equal(calculateTaskPoints({...resumed,status:TaskStatus.DONE,completedAt:'2026-01-04T11:00:00'},config,new Date(now)).totalAwarded,120);
  assert.equal(calculateTaskPoints({...resumed,status:TaskStatus.DONE,completedAt:'2026-01-04T13:00:00'},config,new Date(now)).totalAwarded,90);
  assert.equal(isTaskOverdue({...resumed,status:TaskStatus.DONE},instant('2026-02-01T00:00:00')),false);
});

test('missing deadlines and future hold starts cannot fabricate lateness or extra pause credit',()=>{
  assert.equal(effectiveTaskDeadline(task({dueAt:null})),null);
  assert.equal(effectiveTaskDeadline(task({dueAt:'invalid'})),null);
  assert.equal(effectiveTaskDeadline(task({holdStartedAt:'2026-02-01T00:00:00',holdPausedSeconds:-100}),instant('2026-01-01T10:00:00')),instant('2026-01-01T12:00:00'));
});
