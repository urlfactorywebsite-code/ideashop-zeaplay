# Phase 7 Subtask Workflow Engine

## Status Transition Matrix

User/API initiated transitions:

| From | Allowed To | Notes |
| --- | --- | --- |
| WAITING | IN_PROGRESS | Force-start only. Requires reason and either the assigned subtask user or an authorized workflow manager/admin. Dependencies are preserved. |
| WAITING | TODO | System activation only when all predecessor subtasks are DONE. |
| TODO | IN_PROGRESS, BLOCKED, DONE | Direct completion is kept for compatibility with the legacy completed checkbox. |
| IN_PROGRESS | TODO, BLOCKED, IN_REVIEW, DONE | DONE marks the subtask completed and evaluates successors. |
| BLOCKED | TODO, IN_PROGRESS, IN_REVIEW | BLOCKED is not a completed state. |
| IN_REVIEW | TODO, IN_PROGRESS, BLOCKED, DONE | IN_REVIEW is not a completed state. |
| DONE | TODO, IN_REVIEW | Reopening triggers downstream review marking. |

Invalid direct transitions return `409 Conflict`. A force-start without a reason returns `422`, and an unauthorized force-start returns `403`.

## Dependency Behavior

- Dependency evaluation runs inside the request database transaction and locks the task's subtask/dependency rows where supported by the database.
- Dependency graph mutations lock same-task workflow rows before cycle and duplicate-edge validation so concurrent edits serialize around the same task graph.
- When a subtask reaches DONE, each WAITING successor is evaluated. If all predecessors are DONE, the successor moves to TODO.
- Already active successors are not activated again.
- Parallel independent subtasks remain actionable; only WAITING subtasks with dependencies are activation candidates.
- Force-start moves a WAITING subtask to IN_PROGRESS without deleting dependency edges.
- Force-start history records actor, timestamp, reason and blocked predecessor IDs in `subtask_workflow_events`.
- Activation events use deterministic event keys so duplicate activation processing is idempotent.
- Reopening a DONE predecessor marks affected downstream active/completed subtasks as IN_REVIEW and incomplete. WAITING downstream work remains WAITING.

## Phase 10 Notification Preparation

The workflow engine records durable workflow events and publishes lightweight `subtask.workflow` domain-event payloads after commit through the existing task event channel. Email delivery is intentionally not performed inside the workflow transaction.

## Reliability Notes

- Production PostgreSQL uses the existing SQLAlchemy session with `READ COMMITTED` defaults and `SELECT ... FOR UPDATE` row locks for workflow evaluation.
- Local SQLite tests do not prove PostgreSQL row-lock blocking behavior; they verify durable invariants: duplicate completion does not duplicate activation history, failed activation rolls back status/history, and graph-cycle mutations do not persist.
- `subtask_workflow_events.event_key` is unique for activation events, preserving idempotent activation history.
