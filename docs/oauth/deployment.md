# OAuth deployment and rollback

This is the refined release runbook. Current execution evidence and limitations
are in [refinement/report.md](refinement/report.md). Local verification does not
certify a VPS or production proxy.

## Configuration and release order

1. Save the current backend/frontend image digests or tags, back up PostgreSQL
   using pg_dump custom format, validate its catalog with pg_restore -l, and keep
   backups private. Existing OAuth configuration may contain legacy plaintext
   credentials; never publish database dumps or environment files.
2. Review the database migration state with bootstrap schema changes disabled.
   Apply base revision `ffb1e2f3a4b5` and additive index revision `ffc2f3a4b5c6`
   through the appropriate path below. Do not replay
   all historical migrations on a database created by startup helpers.
3. Install `backend/requirements.txt` (OAuthlib is pinned to 4.0.0) or build the
   backend image. Apply storage before deploying the matching frontend: browser
   login now uses `browser_sessions` in addition to the existing API tokens.
4. Configure canonical public values in the deployment's existing environment:

   ```dotenv
   VEE_BOOTSTRAP_SCHEMA=false
   VEE_ENVIRONMENT=production
   VEE_OAUTH_ISSUER=https://api.ideashop.zeacrm.com/api/oauth2
   VEE_OAUTH_UI_URL=https://ideashop.zeacrm.com/#/oauth/authorize
   VEE_OAUTH_AUDIENCE=zeaplay-api
   VEE_CORS_ALLOW_ORIGINS=["https://ideashop.zeacrm.com","https://api.ideashop.zeacrm.com"]
   ```

   See [the live-domain runbook](../live-domains/README.md) for NPM and rollout.
   URLs must use HTTPS in production,
   without credentials, queries or trailing slashes. The UI URL includes the
   hash route. Blank issuer/UI settings disable issuance. Keep existing JWT
   keys and tenant configuration; use strong managed secrets in production.
   Replacing existing JWT keys signs out users and is a separate migration.
   Production startup rejects default, shared, or shorter-than-32-byte signing
   keys and non-HTTPS/wildcard CORS configuration. Supply independent random
   signing secrets through the deployment secret manager before restart.
5. Build and deploy backend and frontend using the existing production Compose
   configuration. Ensure it actually passes the OAuth variables into the backend
   (the local Compose additionally reads ignored `.env.oauth.local`). Ensure
   first-party frontend API variables point to the intended public API.
6. Prefer a same-origin API proxy, or same-site HTTPS frontend/API hosts, so the
   HttpOnly SameSite=Lax session cookie can work. Use explicit CORS origins,
   credentials enabled, and permit `X-Zea-Browser` and Authorization headers.
   Cookie resources require Origin plus `X-Zea-Browser: 1`; ordinary resources
   and consent require an explicit bearer JWT. Production cookies use the name
   `__Host-zea_browser_session`, Secure, HttpOnly, SameSite=Lax and Path=/ with
   no Domain attribute. Development uses `zea_browser_session`. Changing the
   production cookie name requires one sign-in after deployment.
   Old localStorage credentials are removed; users must sign in once.
   `/oauth2/token` and `/oauth2/revoke` additionally permit public CORS without
   cookies so registered third-party browser clients can exchange PKCE codes.
   Scoped GET profile/service/project/task resources also permit public CORS
   without cookies. Their fetch requests must omit credentials. Management/session endpoints
   retain the explicit origin policy; this does not enable cookie-based API access.
7. Configure TLS, a trusted proxy chain and correct real-client IP handling.
   The database rate limiter permits 120 protocol requests/minute per peer IP
   and 120 token issuances/minute per validated client, shared
   across workers. Invalid claimed client IDs cannot spend a client's issuance
   budget. Throttling returns 429 and Retry-After: 60 without consuming a code
   or refresh token. Do not trust arbitrary forwarded
   headers or log Authorization, form bodies, secrets or callback query strings.
   The shipped frontend nginx disables access logging and sets referrer/frame
   headers. Uvicorn access logs redact query strings. Apply equivalent
   query-redacting logs at any outer reverse proxy, APM and ingress. Never
   enable request-body/Authorization capture. OAuthlib credential loggers are
   disabled. Check the same-origin discovery proxy as well as the API host.

## Versioned database

Inspect `alembic current` and `alembic heads` from `backend`. The new revision
follows `ffa0d1e2f3a4` (the reporting index already present in this workspace).
Review intervening revisions independently if the deployment is behind it.
On a database already at the reviewed parent:

```sh
cd backend
alembic upgrade ffc2f3a4b5c6
```

Never stamp an unversioned live schema merely to make this command succeed.
The base migration creates eight tables and indexes. The refinement adds seven
indexes only; it does not rewrite business data or SMTP storage. For an existing
base installation, review and apply only its child revision. On large tables,
ordinary CREATE INDEX can block writers: schedule a maintenance window or use
a separately reviewed PostgreSQL concurrent-index procedure, then verify the
installer's complete index definitions before resuming traffic.

## Unversioned legacy PostgreSQL database

Use the guarded installer only for the legacy layout. It runs the exact same
revision through Alembic Operations without creating or stamping alembic_version.
It checks existing user identity columns and composite uniqueness, refuses
versioned/partial installations and verifies existing columns, types, nullability,
primary/unique constraints, foreign-key targets and indexes on repeat runs.

```sh
docker compose run --rm --no-deps backend python -m app.services.oauth_install
# Fresh: ready_to_install. Existing base: refinement_required.
# Fully installed repeat: already_compatible.
docker compose run --rm --no-deps backend python -m app.services.oauth_install --apply
# Fresh: installed. Existing base: refined. Repeat: already_compatible.
docker compose up -d --no-deps backend frontend
docker compose exec -T backend python -m app.services.oauth_install
# Must report already_compatible.
```

Use the proper `-f` and `--env-file` flags for that environment. The CLI refuses
bootstrap mode. An unknown or partial schema requires investigation/restore,
not automatic repair or schema stamping. Application startup does not install
these tables when bootstrap is disabled.

## Retention and session behavior

Run the cleanup CLI with bootstrap disabled and review its dry run first:

```sh
docker compose exec -T backend python -m app.services.oauth_cleanup --batch-size 1000 --grace-days 7
# Only after reviewing retention policy and the dry-run counts:
docker compose exec -T backend python -m app.services.oauth_cleanup --batch-size 1000 --grace-days 7 --apply
```

Each run is one bounded transaction. Repeat batches on an operator-controlled
schedule. Spent refresh tokens and authorization codes remain while their grant
is live: deleting them early breaks replay detection. Only grants expired or
revoked beyond the grace period and their children are eligible. Consent and
browser-session rows follow the same grace policy. Audit events and registered
clients are retained; define separate archival/retention policy for those.

Logout revokes the server session and marks this browser signed out immediately,
even when the network fails. The non-secret localStorage marker prevents silent
cookie restoration on reload. A failed network logout cannot revoke the server
row; explicit sign-in replaces the old session, or it expires. Logout deliberately
does not emit a delayed cookie deletion that could overwrite a later login's
cookie. The revoked cookie value can remain until replacement/expiry. Existing
first-party bearer JWTs retain their existing expiry/credential-version behavior;
this is not global JWT logout. Cross-tab request serialization uses Web Locks
where supported; older browsers retain a per-tab queue and session intent guards.

## Validation before public rollout

- Check `/health`, `/ready`, `/openapi.json`, protected `/api/oauth2/dashboard`,
  and `/.well-known/oauth-authorization-server/api/oauth2` for the example issuer.
- Anonymous users and users from other tenants must not manage clients.
- Use isolated test clients/users, run PKCE and client credentials, check consent
  denial, scope restrictions, refresh rotation/replay and immediate revocation.
- Verify existing login, cookie reload/logout, API JWTs, bearer-key builder,
  resource permissions, SMTP read-only status and webhooks. Do not send SMTP
  messages or fire webhooks as part of this check without separate authorization.
- Fix the unrelated repository TypeScript errors recorded in `typescript.txt`
  before claiming a clean production certification. Repeat environment-specific
  validation; local results do not certify a VPS.

Legacy `/config/oauth` calls now return 410 and the password-grant stub is
retired. Re-register applications through `/oauth2/clients`; tenant ownership
cannot safely be inferred from the old global registry. Retained legacy rows
are not active OAuth clients. Review and retire any legacy stored credentials
under the deployment's retention policy. The local registry had zero rows.

## Rotation and compromise response

Secrets expire after 90 days. Rotate through the client screen, store the new
value immediately in the backend secret manager, update the integration and
obtain new grants. The old secret and all existing grants stop working. Public
clients never have a secret. Access tokens last ten minutes. Refresh tokens
rotate on every exchange, expire after seven days, and inherit a thirty-day
absolute grant lifetime. Reuse revokes all tokens in the affected grant.
For compromise, disable/archive the client or revoke affected grants. Investigate
tenant OAuth audit events without copying credential material. Opaque OAuth
tokens do not require signing-key rotation or JWKS. Existing first-party JWT key
rotation remains an independent operational procedure.

## Rollback

Prefer rolling back code/images while retaining the additive tables. Keep
issuance disabled and block legacy `/oauth2/token` password-grant and
`/config/oauth` endpoints at the proxy before running older images; those old
implementations were unsafe. Restore tagged backend/frontend images together
and require sign-in again if switching browser storage behavior. Do not restore
the full database merely to undo additive OAuth storage: doing so would discard
unrelated business changes after the backup.

For a versioned deployment, only after disabling OAuth, stopping matching code,
exporting required audit data and checking that no new application session needs
retention, `alembic downgrade ffa0d1e2f3a4` removes the eight new tables. This
permanently deletes OAuth grants, verifier metadata, audit and browser sessions;
users must sign in again. Existing users/tasks/projects/SMTP/webhooks are retained.
On an unversioned deployment there is no Alembic revision to downgrade: leave
the additive tables in place during image rollback; use a separately reviewed
schema removal procedure if retention policy requires deletion.

For this refinement, the rollback tags are
`zeaplay-backend:before-oauth-refinement-20261020` and
`zeaplay-frontend:before-oauth-refinement-20261020`. Private backup and verification
hashes are under `C:\Users\Lenovo\.codex\backups\oauth-refinement-20261020`.
These older images include the initial implementation's reviewed defects;
disable issuance while rolling back. Prefer retaining the seven extra indexes.
For a versioned database, `alembic downgrade ffb1e2f3a4b5` removes only the
refinement indexes; it does not restore application behavior or delete OAuth data.
