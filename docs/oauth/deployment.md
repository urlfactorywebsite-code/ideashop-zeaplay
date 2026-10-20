# OAuth deployment and rollback

The local Docker deployment has been migrated and rebuilt. This document is a
runbook for another environment, not evidence of VPS deployment.

## Configuration and release order

1. Save the current backend/frontend image digests or tags, back up PostgreSQL
   using pg_dump custom format, validate its catalog with pg_restore -l, and keep
   backups private. Existing OAuth configuration may contain legacy plaintext
   credentials; never publish database dumps or environment files.
2. Review the database migration state with bootstrap schema changes disabled.
   Add only revision `ffb1e2f3a4b5` through the appropriate path below. Do not replay
   all historical migrations on a database created by startup helpers.
3. Install `backend/requirements.txt` (OAuthlib is pinned to 3.3.1) or build the
   backend image. Apply storage before deploying the matching frontend: browser
   login now uses `browser_sessions` in addition to the existing API tokens.
4. Configure canonical public values in the deployment's existing environment:

   ```dotenv
   VEE_BOOTSTRAP_SCHEMA=false
   VEE_ENVIRONMENT=production
   VEE_OAUTH_ISSUER=https://api.example.com/api/oauth2
   VEE_OAUTH_UI_URL=https://app.example.com/#/oauth/authorize
   VEE_OAUTH_AUDIENCE=zeaplay-api
   VEE_CORS_ALLOW_ORIGINS=["https://app.example.com"]
   ```

   Use the deployment's actual domains. URLs must use HTTPS in production,
   without credentials, queries or trailing slashes. The UI URL includes the
   hash route. Blank issuer/UI settings disable issuance. Keep existing JWT
   keys and tenant configuration; use strong managed secrets in production.
   Replacing existing JWT keys signs out users and is a separate migration.
5. Build and deploy backend and frontend using the existing production Compose
   configuration. Ensure it actually passes the OAuth variables into the backend
   (the local Compose additionally reads ignored `.env.oauth.local`). Ensure
   first-party frontend API variables point to the intended public API.
6. Prefer a same-origin API proxy, or same-site HTTPS frontend/API hosts, so the
   HttpOnly SameSite=Lax session cookie can work. Use explicit CORS origins,
   credentials enabled, and permit `X-Zea-Browser` and Authorization headers.
   Cookie resources require Origin plus `X-Zea-Browser: 1`; ordinary resources
   and consent require an explicit bearer JWT. Production cookies are Secure.
   Old localStorage credentials are removed; users must sign in once.
   `/oauth2/token` and `/oauth2/revoke` additionally permit public CORS without
   cookies so registered third-party browser clients can exchange PKCE codes.
   Their fetch requests must omit credentials. Management/session endpoints
   retain the explicit origin policy; this does not enable cookie-based API access.
7. Configure TLS, a trusted proxy chain and correct real-client IP handling.
   The database rate limiter permits 120 protocol requests/minute per peer IP
   and claimed client ID, shared across workers. Do not trust arbitrary forwarded
   headers or log Authorization, form bodies, secrets or callback query strings.
   The shipped frontend nginx disables access logging and sets referrer/frame
   headers. Apply equivalent query-redacting logs at any outer reverse proxy.

## Versioned database

Inspect `alembic current` and `alembic heads` from `backend`. The new revision
follows `ffa0d1e2f3a4` (the reporting index already present in this workspace).
Review intervening revisions independently if the deployment is behind it.
On a database already at the reviewed parent:

```sh
cd backend
alembic upgrade ffb1e2f3a4b5
```

Never stamp an unversioned live schema merely to make this command succeed.
The migration creates eight tables and indexes, references existing users and
tenants, and does not rewrite existing business data or SMTP storage.

## Unversioned legacy PostgreSQL database

Use the guarded installer only for the legacy layout. It runs the exact same
revision through Alembic Operations without creating or stamping alembic_version.
It checks existing user identity columns and composite uniqueness, refuses
versioned/partial installations and verifies existing columns, types, nullability,
primary/unique constraints, foreign-key targets and indexes on repeat runs.

```sh
docker compose run --rm --no-deps backend python -m app.services.oauth_install
# Must report ready_to_install, or already_compatible for a verified repeat.
docker compose run --rm --no-deps backend python -m app.services.oauth_install --apply
docker compose up -d --no-deps backend frontend
docker compose exec -T backend python -m app.services.oauth_install
# Must report already_compatible.
```

Use the proper `-f` and `--env-file` flags for that environment. The CLI refuses
bootstrap mode. An unknown or partial schema requires investigation/restore,
not automatic repair or schema stamping. Application startup does not install
these tables when bootstrap is disabled.

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

Local rollback images: `zeaplay-backend:before-oauth-20261020` and
`zeaplay-frontend:before-oauth-20261020`. Private database backup and verification
hashes: `C:\Users\Lenovo\.codex\backups\oauth-20261020`.
