# OAuth architecture assessment (2026-10-20)

## Audit before implementation

`frontend/pages/ApiOverview.tsx` includes `oauth` in its tab state and navigation,
but has no `activeTab === 'oauth'` rendering branch. This causes the blank tab.
The page is owner-only. SMTP is a separate component/router and is out of scope.

The FastAPI backend mounts routers at both `/` and `/api`. Existing login uses
`app/auth.py`, bcrypt, HS256 JWT access/refresh tokens, `credentials_version`,
active-user checks and UUID tenant IDs on users. Roles are user, manager, admin,
owner. There is no tenant table: tenant membership is an attribute of existing
users. Project services and task routes implement resource access policies.

`routers/oauth2_server.py` is a password-grant stub with a hardcoded signing key
and no tenant claims. It is not a functioning authorization server for Zea.Play
APIs. `oauth_config` is unscoped configuration CRUD that stores/returns plaintext
credentials; it has no relationship to that token stub. Existing documentation
incorrectly advertises authorization-code and refresh grants. There are no
consent, PKCE, introspection, OAuth grants or rotating refresh-token services.
Swagger's redirect endpoint and OAuth2PasswordBearer do not provide them.

`/auth/generate-token` mints existing user JWTs with selected scope claims, not
OAuth grants. It must not be advertised as an OAuth authorization flow. Existing
first-party refresh tokens are separate from OAuth refresh tokens. The browser
currently persists these first-party credentials in localStorage: this is a
security limitation to remediate explicitly, without silently changing API login
contracts. Database startup helpers perform legacy DDL outside Alembic. A live
legacy database must not be blindly stamped or upgraded through the entire
historical chain.

Google Drive has a separate external-storage integration. No configured OIDC
identity provider or general Google/Microsoft login integration was found. This
work concerns API clients and user delegation, not external-provider login.

## Decision and incremental implementation plan

1. Reuse current login, users, tenant IDs and resource services. Use OAuthlib's
   authorization-code, PKCE, client-credentials, refresh, revocation and
   introspection protocol engine with SQLAlchemy persistence adapters.
2. Opaque access tokens with SHA-256 verifiers, fixed issuer and audience checked
   against current server configuration, short expiry and immediate database
   revocation. No additional JWT signing keys or JWKS are necessary. Database
   lookup cost is the tradeoff for immediate client/grant revocation.
3. Add tenant-constrained OAuth tables and one Alembic migration. Never import
   legacy plaintext credentials into live OAuth clients. Retire unsafe legacy
   configuration endpoints with a clear migration response.
4. Expose only scopes with implemented enforcement: profile:read, projects:read,
   tasks:read, offline_access, service:read. Delegated reads reuse existing user
   permissions. Service identity can read only its own identity endpoint and
   cannot impersonate a user or read tenant business data. Writes and other
   resource families remain unavailable until separately mapped and tested.
5. Require S256 PKCE for every authorization-code client, exact registered
   redirects, explicit consent, one-use codes and consent tickets. Confidential
   clients authenticate with a one-time generated, bcrypt-hashed secret.
6. Rotate refresh tokens atomically under client/grant serialization, retain
   spent verifiers to detect replay, revoke the entire grant on reuse. Never
   issue machine refresh tokens. Recheck active users and credential versions.
7. Implement owner/admin management, tenant-only metrics and metadata, user
   grant revocation, branded consent and documentation. No token persistence
   or raw-token display in the OAuth management UI.
8. Verify in isolated SQLite/PostgreSQL and controlled browser clients; report
   all remaining deployment and pre-existing authentication limitations honestly.

## Implemented browser-session transport

Browser login now additionally creates a hashed, tenant/user/credential-version
bound session and places its random identifier in an HttpOnly, SameSite=Lax
cookie (Secure in production). Existing JSON login/refresh contracts and API
JWT authentication remain available to existing non-browser clients. Frontend
access/refresh credentials and generated bearer-key history now live in memory.
Old localStorage credentials are removed, so existing users sign in once after
deployment. Reloads obtain a new access JWT from the protected browser-session
refresh endpoint. A strict Origin check plus a custom non-simple header protects
cookie refresh/logout. Cookie authentication is not accepted by resource or
consent endpoints; consent still requires the explicit first-party bearer token.
Logout revokes the browser session. Existing first-party JWTs retain their
pre-existing expiration/credential-version rules; this is not global JWT logout.
Deploy the browser on the same site as the API (prefer a same-origin proxy).

Standalone migration recheck must import existing model metadata, in addition
to the OAuth tables, to resolve composite user foreign keys. This was corrected
and verified in the built local image (`already_compatible`).

Protocol references: https://www.rfc-editor.org/rfc/rfc9700.html,
https://www.rfc-editor.org/rfc/rfc7636.html,
https://www.rfc-editor.org/rfc/rfc7009.html,
https://www.rfc-editor.org/rfc/rfc7662.html,
https://oauthlib.readthedocs.io/en/latest/oauth2/server.html.
