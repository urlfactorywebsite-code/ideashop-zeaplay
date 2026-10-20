# OAuth security and production refinement - 2026-10-20

**Release decision: NOT production-certified.** Security fixes and local checks
are recorded below. The repository-wide TypeScript check still fails with 125
existing diagnostics, and production TLS, ingress, proxy trust, secret management
and rollback rehearsal have not been verified on the target deployment.

Review scope: the newly implemented FastAPI/SQLAlchemy OAuthlib adapter,
authorization UI, existing browser authentication transport and their integration
with Zea.Play tenant/resource permissions. This is source review and automated
adversarial testing, not an independent penetration test or conformance certification.
No live exploit, credential theft or cross-tenant data disclosure is claimed.

## Security findings and corrections

Severity reflects the precondition and impact of the defect, rather than treating
each failing parameterized test as a separate vulnerability. The initial repro
run had 12 failing security/functional assertions and one harness configuration
failure, not 13 independent vulnerabilities. See [before.txt](before.txt).

| ID | Severity | Finding and correction | Evidence |
|---|---|---|---|
| S1 | High, deployment dependent | Production could accept cleartext OAuth/session requests and default/shared JWT signing keys. Enforce HTTPS, independent non-default keys of at least 32 bytes and explicit HTTPS CORS origins. Configuration errors hide input values. Correct proxy scheme handling remains a deployment gate. | Production transport/key/origin tests |
| S2 | Medium | OAuthlib 3.3.1 fell within the vendor's affected PKCE timing-comparison range. Upgrade to 4.0.0; verify constant-time S256 comparison. JSONP revocation was already disabled, so the separate JSONP advisory is not reported as exposed XSS. | Pinned dependency; patched-library regression |
| S3 | Medium | Redirect registration admitted malformed ports, backslashes, empty fragments and blank/encoded reserved response parameters. Validate at registration and authorization; retain exact string matching. | Eight malformed callback cases plus exact-match/PKCE negatives |
| S4 | Medium | Prepared consent survived client edits/rotation, allowing an old consent screen to complete after configuration changed. Consume pending tickets when invalidating a client's grants. | Prepared-consent/edit regression |
| S5 | Medium | Browser logout failure could silently restore a cookie session on reload; late session responses could race a newer intent. Add immediate non-secret signed-out intent, serialized login/logout, generation checks and safe cross-tab notification. Reject stale restoration and remove raw credentials from refresh events. | Frontend suite; real browser aborted-logout/reload/re-login |
| S6 | Medium | Cookie origin checks inferred trust from Host; production cookie lacked the __Host- prefix. Trust configured origins only and use host-only Secure/HttpOnly/SameSite=Lax cookie at Path=/. Avoid delayed deletion of a newer login cookie. | Origin/production-cookie/session regressions |
| S7 | Medium | Protocol DB/bcrypt work ran on the async event loop; unauthenticated secret verification held the client lock. Use a worker thread, verify before locking, then recheck hash/status after locking. Invalid claimed client IDs could also exhaust a client's shared budget. Charge the canonical client only after grant/PKCE validation. | Thread, conflicting-auth, rotation, concurrency and budget tests |
| S8 | Medium | Callback query strings could enter Uvicorn access logs; default Pydantic validation could echo a mistakenly submitted secret. Redact access-log queries, reject protocol URL parameters and omit validation input/context from OAuth errors. Keep OAuthlib credential loggers disabled. | Log/error/query/JSONP regressions |
| S9 | Low, defense in depth | Token checks did not explicitly restrict stored token kind or token scopes to grant scopes. Enforce both as well as existing grant/client/tenant checks. | Scope, issuer, audience, expiry and tenant negatives |
| F1 | Medium, functional | expires_in could exceed remaining absolute grant lifetime; management token metadata could look active after grant revocation. Cap lifetime and report effective client/grant state. | Short remaining grant and effective-revocation tests |
| F2 | Medium, functional | Public browser clients could exchange tokens but CORS blocked scoped resource reads; same-origin discovery reached SPA fallback. Add credential-free read CORS on the explicit resource allowlist and proxy discovery to FastAPI. | Separate-origin browser and resource preflight tests; runtime proxy probe |
| F3 | Medium, availability/operations | Dashboard loaded entire grant history with per-row lookups; search stopped at the first 500 results; retention/index support was incomplete. Use bounded aggregates/server search, seven additive indexes and bounded cleanup that preserves live replay evidence. | 550+ grant aggregate test, migration/installer roundtrip, cleanup retention tests |
| P1 | Low, protocol interoperability | Registered-callback authorization errors such as invalid_scope returned a direct error rather than redirecting with state. Redirect nonfatal OAuthlib errors only after client/callback validation, preserving state and issuer; invalid callbacks never receive redirects. Also accept case-insensitive Bearer on service identity. | Authorization error and service-header regressions |

The dependency finding is based on the
[vendor PKCE advisory](https://github.com/oauthlib/oauthlib/security/advisories/GHSA-xpv3-w29h-x7cv)
(affected versions below 3.3.2 in the 3.x line, moderate severity),
[4.0.0 release](https://github.com/oauthlib/oauthlib/releases/tag/v4.0.0), and
[JSONP advisory](https://github.com/oauthlib/oauthlib/security/advisories/GHSA-hj66-6f7g-4r5v).

## Protocol and authorization findings

| Review area | Result and supported boundary |
|---|---|
| Code flow / PKCE / redirects | S256 mandatory for public and confidential clients; plain/implicit/password grants disabled. Exact registered callbacks, state and authorization-response issuer; one-use 120-second code. |
| Client authentication / rotation | Public clients have no secret and cannot use client_credentials. Confidential clients require active, unexpired bcrypt-verified secrets. Rotation immediately invalidates old secret, grants and pending consent. Conflicting header/body credentials are rejected. |
| Access tokens | Opaque random tokens stored only as SHA-256 verifiers; maximum 600-second life, bounded by grant life. Validate issuer, audience, type, expiry, client, subject, credential version, tenant, grant and scopes on use. No JWT decoding/JWKS applies to these tokens. |
| Refresh tokens | Rotate on every exchange, maximum seven-day refresh life and 30-day absolute grant life. Atomic consumption/client serialization prevents two successful successors. Reuse revokes the entire family; live spent evidence is retained. No machine refresh tokens. |
| Tenant / scopes / RBAC | Explicit delegated GET allowlist for profile/projects/tasks. Existing user/resource policy remains authoritative. OAuth tokens cannot administer OAuth/SMTP/webhooks, use key builder or acquire the full first-party JWT API surface. Machine tokens read only their own service identity. |
| Consent / roles | Authenticated user and tenant-bound five-minute one-use tickets; explicit allow/deny; user grant revocation. Owner/admin manage only their tenant; ordinary users cannot manage clients. |
| Errors / limits / CORS / CSRF | Form-body protocol, duplicate rejection and 8 KB body bound; no-store token/error responses; shared fixed-window IP and validated-client limits. Public token/revoke and scoped-read CORS omit credentials; management keeps configured origins. Cookie routes require Origin and X-Zea-Browser: 1. |
| Storage / disclosure | No tokens or client secrets in localStorage/sessionStorage. Non-secret logout/cross-tab markers are allowed. Management GETs return metadata only. Tokens must appear in successful token responses and secrets appear once on authorized create/rotate; existing non-browser login JSON contracts remain. Those intentional credential responses are no-store. |
| Database / retention | Composite identity/tenant foreign keys, verifier uniqueness and transactional consumption retained. Refinement is seven additive indexes, no data rewrite. Cleanup retains audit events and replay evidence for live grants. |
| Standards boundary | OAuthlib supplies protocol processing; project adapters supply storage, policy, consent and concurrency. RFC 9700/7636/7009/7662/8414/9207 behavior is the review reference, not a claim of independent certification or complete OAuth/OIDC feature coverage. |

The standards reference is the
[OAuth security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html),
with implementation responsibilities described by
[OAuthlib's validator contract](https://oauthlib.readthedocs.io/en/latest/oauth2/validator.html).

## Executed checks

Earlier failed/incomplete logs remain for traceability; they are not final PASS
evidence. Tests use disposable users, clients, schemas and synthetic credentials.

| Check | Current evidence |
|---|---|
| Final source suite, SQLite | **PASS: 55 passed**, 42 PostgreSQL cases deselected; [log](sqlite-verified.txt) |
| Protocol/security, SQLite + PostgreSQL, Windows Python 3.14 | **PASS: 97 passed**, no skipped cases; [log](protocol-verified.txt) |
| Built-image Linux Python 3.11 protocol/security, SQLite + PostgreSQL | **PASS: 97 passed**, no skipped cases; pytest installed only into ephemeral tmpfs; [log](linux-protocol-verified.txt) |
| Existing password recovery, SMTP management/refinement, bearer builder | **PASS: 161 passed, three skipped** (two require isolated Redis; one intentionally PostgreSQL-only case skipped on SQLite); [log](regressions-verified.txt) |
| Previously skipped Redis regressions | **PASS: two passed** with dedicated disposable Redis and SQLite/PostgreSQL fixtures; [log](redis-regression-verified.txt). Only the intentional SQLite migration skip remains uncovered in that parameterization; its PostgreSQL counterpart passed. |
| Frontend automated suite | **PASS: 129 passed**, zero skipped; [log](frontend-tests.txt) |
| Browser, PostgreSQL API | **PASS: eight workflow groups**, no pageErrors; [log](browser-postgres.txt), [structured results](postgres-browser/browser-results.json) |
| Browser, SQLite API | **PASS**; [log](browser.txt), [results](checks/browser-results.json) |
| Responsive / keyboard | Chromium 1440/768/375 widths, no page overflow, reduced-motion preference, Escape dialog; [desktop](postgres-browser/management-1440.png), [tablet](postgres-browser/management-768.png), [mobile](postgres-browser/management-375.png) |
| Native Vite production build | **PASS**; existing Lottie eval/chunk-size warnings; [log](frontend-build.txt) |
| Backend and frontend container builds | **PASS** after disk/WSL recovery; [backend](container-backend-verified.txt), [frontend](container-frontend-verified.txt) |
| Scoped Ruff | **PASS** with documented existing-rule exclusions B008/F811/C408/E402; [log](lint-verified.txt) |
| Documentation | Public/confidential/machine examples supplied; JavaScript/Python syntax, evidence JSON and local report links checked. Example deployment domains still require real integration testing. |
| Full TypeScript | **FAIL: 125 existing diagnostics**, no new OAuth/session-file diagnostics identified; [log](typescript.txt) |
| Local legacy schema refinement | **PASS:** refinement_required -> refined (`ffc2f3a4b5c6`) -> already_compatible; [log](migration-verified.txt) |
| Rebuilt local running API | **PASS**: health/readiness, admin authentication, wrong-tenant denial, metadata/scopes, legacy retirement, existing bearer builder, SMTP/webhook reads and form OpenAPI; [results](runtime-verified.json) |
| Same-origin nginx discovery | **PASS**: correct configured issuer and S256-only metadata; [results](proxy-verified.json) |
| Running source and image identity | Backend security-file hashes match the reviewed workspace; [hash comparisons](running-source-verified.json), [current/rollback images](images-verified.txt). Nginx syntax check passed. |
| Running-image cleanup dry run | **PASS**, zero eligible rows; no live cleanup applied; [results](cleanup-dry-run.json) |
| Business data preservation | **PASS**: users(6), tasks(9), projects(1), SMTP config(1), webhook subscriptions(0) match pre-change hashes; [results](business-data-verified.json) |

The browser API is real for auth/OAuth/scoped reads. Unrelated background UI APIs
are stubbed by the E2E harness; the browser run alone does not prove all application
pages. SMTP providers and webhook destinations were not contacted. There is no
outbound email/delivery or webhook execution claim.

## Files changed in this refinement

Some reviewed changes are already present in HEAD; do not infer the complete
review scope from the final unstaged diff alone. This inventory includes the
refinement fixes already present there:

- `backend/app/services/oauth.py`, `browser_session.py`: protocol adapter,
  lifetime, policy, locking, limits, consent/session invalidation.
- `backend/app/routers/oauth_management.py`: authorization errors, worker
  dispatch, bounded dashboard, safe errors and effective metadata.
- `backend/app/oauth_schemas.py`, `oauth_models.py`, `oauth_cors.py`,
  `oauth_logging.py`, `config.py`, `main.py`, `routers/auth.py`: validation,
  indexes, public-read CORS, log redaction, production settings and session limits.
- `backend/app/services/oauth_install.py`, `oauth_cleanup.py`,
  `backend/alembic/versions/ffc2f3a4b5c6_oauth_cleanup_indexes.py`: guarded
  refinement and bounded retention.
- `backend/requirements.txt`, `.env.production.example`: patched library and
  HTTPS production origins.
- `frontend/services/browserSession.ts`, `mockApi.ts`, `tokenStorage.ts`,
  `frontend/hooks/useAuth.tsx`, `frontend/components/OAuthManagement.tsx`,
  `frontend/nginx.conf`: session coordination, token-free events, server search,
  metadata labels and discovery proxy.
- `backend/tests/test_oauth_refinement.py`, `test_oauth2_server.py`,
  `frontend/test/oauth.test.ts`,
  `frontend/e2e/oauth.mjs`, `ops/oauth_smoke_server.py`,
  `ops/oauth_refinement_snapshot.py`: security regressions and isolated evidence.
- `docs/oauth/deployment.md`, `architecture.md`, `report.md`, this directory's
  report, integration examples and evidence artifacts.

No SMTP management implementation, SMTP delivery configuration or webhook
business behavior was intentionally rewritten. No commits, staging or pushes
were performed by this review.

## Known limitations and deployment gates

- Full repository TypeScript health remains failed. Resolve the baseline before
  a clean release certification. Vite success does not replace type checking.
- Production TLS/Host/proxy/IP handling, Secure cookie behavior through real
  ingress, monitoring redaction and actual client-domain integrations remain
  unverified. Browser coverage is Chromium, not Safari/Firefox or physical devices.
- This release does not provide OIDC, third-party identity-provider login,
  dynamic client registration, write scopes, machine business-data scopes or
  general OAuth access to every existing API.
- Existing first-party JWTs remain valid until expiry/credential-version change;
  browser logout is not global token revocation. Browser network failure can
  prevent immediate server-side logout; the browser marker prevents silent reload
  restoration, and explicit login replaces the previous cookie session.
- Web Locks provide cross-tab serialization where supported. Other browsers
  retain per-tab queues and intent/generation guards. They require separate
  concurrent-tab validation before broad support claims.
- Fixed-window limits are not a volumetric DDoS defense. Configure ingress
  limits, correct trusted peer IPs and alerting. Cleanup requires an operator
  schedule; audit/client archival remains a policy decision.
- Ordinary PostgreSQL index creation can block large tables. The local database
  is small; production index duration/load has not been measured.
- C: filled during the first container build, causing an EXT4 journal/I/O error
  and Docker's filesystem to become read-only. User-freed space and a WSL restart
  recovered Docker. Final builds passed, but available headroom is still low;
  increase capacity before repeated builds or production operation. No Docker
  volume deletion, factory reset or broad prune was used.

## Safe production deployment checklist

- [ ] Resolve the TypeScript gate and review this report's final test results.
- [ ] Preserve known-good backend/frontend images; private pg_dump backup and
  pg_restore catalog/restore rehearsal; confirm sufficient disk/WAL headroom.
- [ ] Review environment and database lineage with VEE_BOOTSTRAP_SCHEMA=false.
  Use versioned Alembic through `ffc2f3a4b5c6`, or the guarded unversioned
  installer; never stamp/replay legacy history to bypass a mismatch.
- [ ] Plan index locking/maintenance. Verify `already_compatible` after applying.
- [ ] Supply canonical HTTPS issuer/UI URL, stable audience, independent managed
  signing keys and explicit HTTPS first-party origins. Coordinate any key change.
- [ ] Deploy matching backend/frontend. Require one production browser sign-in
  for the __Host- cookie change. Test same-site/same-origin cookie routing.
- [ ] Validate trusted proxy chain, HTTPS scheme, real IP, HSTS, public discovery
  and credential-free token/resource CORS on actual client domains.
- [ ] Disable request credential/body/query capture in ingress/APM; inspect
  sanitized access/audit logs without sending real credentials into reports.
- [ ] Repeat positive/negative PKCE, consent denial, code expiry/replay,
  refresh reuse, tenant/RBAC/scope denial, rotation/revocation and mobile checks
  using isolated deployment test identities.
- [ ] Verify existing login, API JWTs, key builder, API permissions and read-only
  SMTP/webhook management. Provider delivery tests need separate authorization.
- [ ] Schedule reviewed retention batches, secret-expiry alerts, error/limit
  monitoring, and a rollback rehearsal. Do not enable public issuance until gates pass.

## Rollback considerations

The pre-refinement database dump and business hashes are private under
`C:\Users\Lenovo\.codex\backups\oauth-refinement-20261020`; pg_restore catalog
contained 709 entries. Rollback image tags are
`zeaplay-backend:before-oauth-refinement-20261020` and
`zeaplay-frontend:before-oauth-refinement-20261020`.

Disable issuance before reverting to those images, since they contain the reviewed
defects. Roll backend/frontend back together; require sign-in if session behavior
changes. Retain additive OAuth data and indexes. Do not restore the whole database
to undo an index-only change and discard unrelated business activity. Versioned
`alembic downgrade ffb1e2f3a4b5` removes only seven refinement indexes; no
automatic downgrade applies to the unversioned installer. Removing base OAuth
tables is destructive and unnecessary for this rollback.

Follow [deployment.md](../deployment.md) and the
[integration examples](integration-examples.md) for concrete commands and client
flows. A backup catalog check is not a completed restore rehearsal.
