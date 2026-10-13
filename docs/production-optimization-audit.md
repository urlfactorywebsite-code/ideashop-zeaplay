# ZeaPlay Production Optimization Audit

## Current Bottlenecks

### Critical
- Achievements loaded full task history and leaderboard task data before rendering the page.
- Task detail modal waited for task, linked-task group, and comments sequentially.
- Legacy `/api/tasks` can return all visible tasks, which does not scale to 100k+ tasks.
- Several UI sections render full arrays directly; large histories, badges, users, and dropdowns need virtualization.
- Backend task listing still performs count and status aggregations on filtered task subqueries for every uncached page.

### High
- Dropdown data loads full user lists and renders all options.
- Backend is mostly synchronous SQLAlchemy work inside request handlers.
- Expensive gamification, notification, webhook, and reporting operations still run close to request flow in several paths.
- WebSocket events invalidate broad task caches and can force extra reloads.
- Frontend caching is custom LRU, not a full stale-while-revalidate query layer.

### Medium
- Large animation blocks on the achievements leaderboard can add paint/composite pressure.
- Images and uploaded reward/media assets need explicit thumbnail/WebP variants.
- Route splitting exists, but chunk strategy is still coarse and the main bundle remains large.
- Runtime logs and debug statements should be removed from hot render paths.

## Changes Applied In This Pass

- Achievements now renders after critical data only: badges, users, rewards, and departments.
- Owner points history task loading now runs in idle/background time and shows skeleton rows.
- Achievement cards render in small chunks of 5 to avoid blocking the UI.
- Task detail modal opens using the list/kanban preview task immediately.
- Task detail fetch now hydrates linked tasks and comments in parallel.
- Task cards prefetch full task details on hover/focus.
- Route fallback now uses a skeleton shell instead of a plain loading screen.
- Task summary prefetch was disabled by default and guarded against duplicate in-flight calls.
- Added `backend/sql/performance_indexes.sql` for production index rollout.

## Target Architecture

### Frontend
- Add TanStack Query for server-state caching, request dedupe, stale-while-revalidate, retries, and optimistic updates.
- Add virtualization for task list/grid, achievement deck, points history, activity feed, comments, and assignee dropdowns.
- Split modals and heavy editor libraries into separate lazy chunks.
- Use section-level skeletons and keep route shells mounted during navigation.
- Use hover/focus prefetch for task details, comments, and lightweight summaries.

### Backend
- Run FastAPI behind Gunicorn/Uvicorn workers:
  `gunicorn -w 4 -k uvicorn.workers.UvicornWorker app.main:app`
- Move notifications, webhooks, badge recalculation, recurrence generation, analytics, email, AI, and file processing to Celery/RQ/Dramatiq.
- Add Redis for response caching, task summary caching, dashboard stats, users, departments, badge progress, and notification counts.
- Replace full-list APIs with cursor pagination and field-selective summary endpoints.
- Add service/repository boundaries around tasks, achievements, rewards, notifications, and reporting.

### Database
- Use PostgreSQL for production with proper pool sizing and read replicas when needed.
- Add indexes in `backend/sql/performance_indexes.sql`.
- Add materialized or denormalized summary tables for dashboard and achievement aggregates.
- Archive old audit logs, activity rows, notifications, and completed task history.
- Profile slow queries with `EXPLAIN ANALYZE`, `pg_stat_statements`, and application timing middleware.

## Priority Roadmap

### Critical
- Replace `/api/tasks` full-list consumers with paginated or summary endpoints.
- Add cursor pagination for tasks, comments, notifications, activity logs, and points history.
- Move achievement and leaderboard calculations to cached backend summaries.
- Add virtualized rendering for tasks, points history, and dropdowns.
- Add Redis cache and invalidate by event type, not by clearing broad resource groups.

### High
- Introduce TanStack Query and migrate page data hooks incrementally.
- Add Celery/RQ worker with Redis for webhooks, notifications, recurrence, analytics, and badge processing.
- Add task detail endpoint split: core task first, comments/activity/files as separate lazy endpoints.
- Add API response compression and field-selective payloads.
- Add DB query timing middleware and slow query logging.

### Medium
- Add generated image thumbnails and WebP variants for rewards/media.
- Add room-based WebSocket subscriptions and event throttling.
- Split heavy chart/calendar/editor dependencies into explicit chunks.
- Add production observability: Sentry, OpenTelemetry, Prometheus metrics, structured JSON logs.

### Low
- Add CDN headers for static media.
- Add performance budgets in CI.
- Add Lighthouse/Web Vitals tracking.
- Add UI reduced-motion polish for heavy animated panels.

## Security And Production Hardening

- Enforce secure cookies or strict token storage strategy.
- Add rate limits for auth, task mutations, reward claims, uploads, and webhook endpoints.
- Validate upload MIME type and scan files in background.
- Add audit logs for admin, reward, point, role, and permission changes.
- Add CORS allowlist per environment.
- Add backup/restore runbooks and migration rollback strategy.
