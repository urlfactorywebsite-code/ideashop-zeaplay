# OAuth implementation and validation report — 2026-10-20

> Historical implementation report. For the later security review, current
> dependency version, deployment status and remaining gates, see
> [the refinement report](refinement/report.md). Results below describe the
> initial implementation and are not certification of the refined release.

The OAuth module is implemented and running in the local Docker stack at
`http://localhost:6300/#/api/overview` (OAuth tab). Administrators may also use
`/#/api/oauth-apps`; every user can use `/#/oauth/applications`.

**Local feature validation: PASS. Overall production certification: NOT PASS.**
The repository-wide TypeScript check still reports 125 existing errors outside
the implemented OAuth components. VPS deployment and production TLS/proxy
behavior have not been executed. Do not describe this as a certified production
release until those gates pass. Existing users sign in once after deployment
because credentials previously stored in localStorage are removed.

## Existing architecture and root cause

See [architecture.md](architecture.md) for the assessment and plan written before
implementation. The OAuth navigation button selected a valid tab state with no
rendering branch. Existing OAuth configuration CRUD was global and exposed
plaintext credentials; the separate token stub used a placeholder signing key
and only a password grant. Neither implemented API delegation. The old API docs
advertised flows that did not exist. There was no configured identity provider
to integrate. Google Drive storage authorization is a separate existing concern;
general Google/Microsoft login and SMTP OAuth have not been added.

## Implemented architecture and database

OAuthlib 3.3.1 handles the OAuth protocol; SQLAlchemy adapters reuse current users,
UUID tenant assignments, active status, credential versions, roles and resource
permissions. Opaque access tokens require a verifier lookup and validate the
configured issuer, audience, expiry, client, grant, subject, tenant and scope.
Revocation takes effect immediately without JWT key rotation or JWKS.

Revision `ffb1e2f3a4b5` follows the existing reporting-index revision and adds:

- `oauth_clients`: tenant/owner, registration, allowed grants/scopes/callbacks,
  bcrypt secret verifier and expiration; unique unpredictable client ID.
- `oauth_grants`: user or tenant service identity, permissions, credential version,
  absolute lifetime, revocation and last-use metadata.
- `oauth_codes`: hashed, short-lived, one-use PKCE authorization codes.
- `oauth_consents`: hashed one-use consent tickets bound to user, tenant,
  credential version and validated request, with five-minute expiry.
- `oauth_tokens`: hashed access/refresh verifiers and safe lifecycle metadata.
- `oauth_events`: tenant audit events without credentials.
- `oauth_rate_limits`: shared atomic IP/client protocol limits.
- `browser_sessions`: hashed first-party browser session transport for an
  HttpOnly cookie; resources continue using existing bearer JWT authentication.

Composite foreign keys prevent mixed tenant/user/client/grant relationships.
Expiration and tenant lookup indexes, primary/unique constraints and explicit
rollback are included. The local database is unversioned, so the guarded
installer applied exactly this revision without stamping or replaying history.
Standalone repeat verification reports `already_compatible`. Existing business
data and SMTP tables were not rewritten.

## Supported grants and permissions

| Grant | Client | Behavior |
|---|---|---|
| authorization_code | Public or confidential | Exact callback, explicit consent, S256 PKCE required for both; confidential clients also authenticate |
| refresh_token | Authorized code clients | Requires registered/requested offline_access, rotating refresh token, reuse detection and grant-family revocation |
| client_credentials | Confidential only | Tenant service principal, service:read only, no refresh token or user impersonation |

Implicit, password, device, dynamic public registration and OpenID Connect ID
tokens are unavailable. Existing first-party login remains `/auth/login`.

| Scope | Actual enforced API |
|---|---|
| profile:read | GET /oauth2/profile (ID, name, tenant) |
| projects:read | GET /projects and /projects/{id}; existing tenant/member/role checks |
| tasks:read | GET /tasks and /tasks/{id}; existing tenant/assignment/role checks |
| offline_access | Permits rotating refresh tokens for a consented grant |
| service:read | GET /oauth2/service; machine client's own service identity only |

OAuth access is denied by default on every other authenticated endpoint,
including administrative, key-minting, consent and SMTP routes. Scopes cannot
elevate RBAC or cross a tenant boundary. Write scopes and machine access to
business resources are intentionally unavailable until separately mapped and
verified; they are not advertised as working permissions.

## Client management and token lifecycle

Owner/admin users manage only their tenant's clients; managers do not have OAuth
administration permission. Registration supports name, description, category,
public/confidential type, multiple callbacks, grant types, scopes, owner and
enabled state. Search/status filtering, details/edit, disable/re-enable, secret
rotation and archival are available. Tenant context is fixed by the current
identity; there is no cross-tenant administrator selector.

Confidential secrets are shown only on creation or rotation and expire after
90 days. Read APIs never return their verifier or original value. Editing,
disabling, rotation and archival revoke existing grants; re-enabling does not
restore them. Client type cannot be changed in place. Archival retains audit
history and permanently clears the secret verifier.

Authorization codes expire after two minutes and are consumed atomically.
Access tokens expire after ten minutes. Refresh tokens expire after seven days
and inherit the grant's thirty-day absolute expiry. Refresh verifiers are spent
atomically, retained to detect replay and bound to their client and grant.
Replayed refresh tokens or codes revoke the grant family. Concurrent refresh
tests verify one successful exchange and subsequent family revocation. Client
credentials never receives refresh tokens. Users can view and revoke their own
authorized applications; admins can revoke tenant grants.

The dashboard uses persisted counts, seven-day issuance/error activity,
credential expirations, per-client grant usage and recent security events.
Grant/token lists contain safe identifiers, scopes, owners, timestamps and status;
raw access/refresh tokens are never displayed. Last use records successful token
authentication, rather than claiming request-level analytics.

## Security and integration behavior

- OAuthlib protocol validation, exact registered callbacks, mandatory S256,
  unpredictable codes/IDs/secrets, explicit unverified-identity warning, denial
  states, client-side state/issuer helper and no automatic consent.
- User-bound one-use consent ticket, explicit bearer authentication and active
  credential-version validation; OAuth access tokens cannot authorize consent.
- Database-backed immediate revocation, rotated refresh verifiers, replay
  response, atomic consumption and client-row serialization across workers.
- Issuer/audience/expiry/type checks, tenant-bound foreign keys, restricted
  endpoint mapping and existing resource permissions.
- Protocol rate limits shared across workers; credential-free audit events with
  administrator actor attribution. OAuthlib credential-bearing debug logs are
  disabled. API responses are no-store; frontend referrers and framing are blocked.
- Explicit-origin credentialed CORS for first-party administration. Public token
  exchange/revocation permits third-party browser CORS without cookie credentials.
- Browser access/refresh tokens and bearer-key history stay in memory. A hashed
  HttpOnly SameSite=Lax session, Secure in production, restores login on reload.
  Cookie refresh/logout require a matching Origin and X-Zea-Browser header.
  Resource requests and consent do not accept ambient cookie authentication.
- Browser session logout is persisted; pre-existing first-party JWT expiry and
  credential-version behavior is retained. It is not a new global JWT revocation
  service. Existing API bearer-key generation remains compatible and separate
  from OAuth scopes, consent and grant revocation.

Legacy `/config/oauth` now returns 410; the old password-grant stub is retired.
This is an intentional migration boundary. Legacy global credentials cannot be
safely assigned to a tenant automatically. The local legacy registry had no rows.
No SMTP implementation files were modified, SMTP profiles remained unchanged,
and no email or webhook delivery was triggered.

## Validation evidence

| Check | Result |
|---|---|
| OAuth SQLite + isolated PostgreSQL suite | PASS: 54 tests, no skips; backend-tests-final.txt |
| Final client lifecycle / revocation / concurrent-refresh checks | PASS: 6 tests |
| Existing password recovery, SMTP management/refinement, bearer-token tests | PASS: 97; 67 environment-specific tests skipped |
| Entire frontend unit suite | PASS: 127, no skips |
| Real controlled browser flow against isolated PostgreSQL API | PASS; checks/browser-results.json |
| Browser PKCE/consent/refresh/revocation and machine credentials | PASS |
| Responsive 1440/768/375, reduced motion, keyboard dialog, no token persistence | PASS; screenshots in checks/ |
| Backend/frontend Docker production builds | PASS; release-build.txt |
| Focused Ruff and scoped whitespace checks | PASS; lint.txt (existing FastAPI/pytest conventions B008/F811/C408 excluded) |
| Standalone migration and repeat compatibility | PASS; install.txt and install-recheck.json |
| Running local health/readiness/auth/OAuth/SMTP/webhook reads | PASS; running-api.json |
| Running public token CORS / restricted management CORS / frontend headers | PASS; running-cors-frontend.json |
| Application-data preservation | PASS; data-preservation.json |
| Repository-wide TypeScript | FAIL: 125 existing diagnostics; typescript.txt |
| Dedicated frontend lint command | Not configured in existing package scripts |
| VPS/production environment verification | Not performed |

The isolated OAuth tests cover management, tenant/role boundaries, secret
exposure, valid/invalid PKCE, invalid callbacks/scopes/clients, expired/replayed
codes, denial, access expiry/issuer/audience/revocation, refresh replay and races,
machine authentication/introspection, scope escalation, first-party cookie
security, CORS and migration/installer round trips. The independent browser run
reports no page errors. Existing dependency/build warnings (including Lottie
eval and large chunks) remain.

Private before/after row checksums match for all six existing users, nine tasks,
one project, one SMTP profile and the empty webhook registry. The private
pg_dump catalog contains 665 entries. Existing images were tagged before rebuild.

## Files changed for this work

- Backend: `app/oauth_models.py`, `oauth_schemas.py`, `oauth_cors.py`,
  `services/oauth.py`, `browser_session.py`, `oauth_install.py`,
  `routers/oauth_management.py`, `oauth2_server.py`, OAuth-only portion of
  `routers/config.py`, browser-session additions in `routers/auth.py`,
  `dependencies.py`, `config.py`, OAuth router/CORS integration in `main.py`,
  `requirements.txt`, `alembic/env.py`, revision `ffb1e2f3a4b5`,
  `tests/test_oauth2_server.py`.
- Frontend: `components/OAuthManagement.tsx`, `.css`, `OAuthDocumentation.tsx`,
  `pages/OAuthAuthorization.tsx`, `OAuthApplications.tsx`, OAuth rendering/docs
  and memory-only key history in `ApiOverview.tsx`, removal of the unused legacy
  OAuth draft in `Settings.tsx`, `services/oauthApi.ts`, `tokenStorage.ts`,
  browser-session calls in `mockApi.ts` and `hooks/useAuth.tsx`, routes in
  `App.tsx`, OAuth links in `Sidebar.tsx`, `index.html`, `nginx.conf`,
  `utils/oauthClient.ts`, `test/oauth.test.ts`, auth-storage updates to
  `test/notification-realtime.test.ts` and `test/push-browser.test.ts`,
  `e2e/oauth.mjs`.
- Operations/documentation: `.env.production.example`, optional local OAuth env
  file in `docker-compose.yml`, ignored `.env.oauth.local`,
  `ops/oauth_smoke_server.py`, `ops/oauth_runtime_verify.py`, `docs/oauth/`.

Pre-existing reporting, task-notification and other dirty work was retained.
No commits, staging, pushes, SMTP changes or VPS changes were made.

## Deployment, rollback and remaining limits

See [deployment.md](deployment.md) for ordered migration/build steps, strict
configuration, rotation, compromise response, legacy-client transition and
rollback. Local feature verification does not certify production.

The remaining release gate is the existing TypeScript backlog; production
TLS/proxy/cookie operation also requires verification on the target environment.
Lists currently return up to 500 client/grant/token records and 100 audit events;
large deployments should add pagination and database-aggregated dashboard
queries before high-volume operation. Audit retention/export must follow the
deployment's existing policy; no automatic destructive retention job is enabled.
There is no OAuth write access, business-data M2M access, OIDC, external login,
provider mailbox connection, dynamic registration or application verification.
