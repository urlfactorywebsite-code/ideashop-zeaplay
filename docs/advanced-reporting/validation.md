# Reporting validation and acceptance evidence

## Test coverage

| Requested cases | Deterministic evidence |
| --- | --- |
| Zero/multiple tasks, multiple assignees, unassigned parents, project links | Inventory fixtures count each persisted row once, separately count shared task groups and reconcile overview/status/detail totals |
| Multiple subtasks and parent status independence | A completed parent with an unfinished child remains completed in reporting; child joins do not multiply parent counts |
| Completed/in-progress/blocked/overdue and exact status totals | Inventory tests and the existing lifecycle module cover saved statuses, grouped KPI definitions and serialized status compatibility |
| Archived projects and inactive employees | Owner/manager fixtures retain authorized historical work and do not treat archive as completion |
| Combined filters, boundaries, sorting, pagination, empty sets | Inventory and API/UI contract tests validate query results, every displayed sortable field, empty exports and stable pages |
| Date boundaries, DST and cross-midnight work | 23/25-hour local days, inclusive UI/exclusive UTC boundaries, fractional clipping and daily total reconciliation |
| Concurrent timers and snapshot time | 150 minutes of overlapping task effort yields 60 minutes unique time; running intervals use one supplied snapshot; different people remain separate |
| Pause/resume and zero-duration sessions | Explicit linked continuations preserve gaps; zero-second observed starts remain visible without adding effort |
| Unauthorized/cross-tenant access | Unauthenticated/inactive/foreign identities, manipulated project/employee filters, manager-only assigned child, unmanaged peer timers and redacted assignees |
| Exports | Parse real CSV/XLSX responses, compare filtered/sorted displayed data, ignore UI page, retain one export snapshot across batches, preserve fractions, neutralize formulas and reject oversized output without a partial file |
| Large query behavior | 1,000-task fixture verifies bounded query counts; 100,000-event SQLite/PostgreSQL plan probes compare identical result sets before/after the single index |
| Existing workflows | Existing lifecycle tests cover persisted transitions, rollback, parent/subtask statuses, interval unions and read-only repeatable snapshots |
| Frontend behavior | Date presets/URL helpers plus full unit suite, ten desktop/mobile browser interaction groups and real isolated API response/sort/export contract checks |

The API/UI contract test obtains actual responses from isolated FastAPI/SQLAlchemy fixtures and checks the fields and sorting used by the page. Browser checks intercept APIs to test rendering, navigation, accessibility, filtering, failure recovery and exports without production credentials. These two types of evidence complement each other; the browser fixture alone does not prove deployed RBAC.

## Results and scope

- Frontend full unit suite: **PASS, 124 tests**.
- Browser interactions: **PASS, ten check groups**, including 390px layout, keyboard focus and reduced motion.
- Frontend production build: **PASS**, with existing Lottie evaluation and large-bundle warnings.
- TypeScript: **FAIL, 127 existing errors**. An independently archived HEAD checkout produces the same 127 normalized diagnostics; this implementation introduces none.
- Frontend lint: **not available**, because the repository has no lint script/configuration.
- Backend reporting, exports, integration and workflow suite: **PASS, 119 tests**, with two intentional dialect-specific skips. Final current-source lifecycle/time checks: **37 PASS on SQLite** (one PostgreSQL-only check skipped), and **37 PASS on PostgreSQL**, including the final zero-duration edge case. These runs overlap and must not be added as a unique test count. Exact scope is in [verification provenance](checks/verification-provenance.md) and [final manifest](checks/backend-verification-final.json).
- Backend Docker image build: **PASS**, using the final source and updated dependencies; `checks/backend-image-build.txt`.
- Linux image smoke: **PASS**, Python 3.11.17/openpyxl 3.1.5, all twelve reporting routes registered and reject unauthenticated access, Unicode/formula-safe/fractional XLSX round-trip. Evidence: `checks/backend-linux-smoke.txt`.
- The Docker daemon stopped during one expanded verification run. It was recovered, affected PostgreSQL checks were rerun successfully, and all disposable reporting containers were cleaned up. Existing application containers were confirmed running.

## Performance interpretation

Inventory and task status counts use database aggregation over authorized task subqueries. Child totals and recorded effort are preaggregated independently; page enrichment is batched. Pagination/supported sorting execute on the server. The interval endpoint projection is bounded at 50,000 entries only for mathematically necessary union calculations; effort/count grouping stays in SQL.

The lifecycle-period index was added after actual query-plan evidence. The PostgreSQL synthetic probe returned the same 200 matching events from 100,000 rows before/after and used an index-only date range scan after installation. This is evidence for the access path, not a guarantee of production latency under a real workload.

## Release status

The reporting implementation is ready for review with its local test/build evidence and documented history limits. A full repository production-readiness PASS is not claimed while the pre-existing TypeScript failures and missing lint configuration remain. No running application image was replaced, no deployed database migration was applied, and VPS/browser-to-production acceptance remains a deployment step.
