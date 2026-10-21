# Ideashop live domains

Canonical frontend: **https://ideashop.zeacrm.com**

Canonical backend: **https://api.ideashop.zeacrm.com**

Both names resolve to `167.86.108.178`. The initial live check on 21 October 2026
failed TLS with `TLSV1_UNRECOGNIZED_NAME`; the Nginx Proxy Manager hosts/certificates
still need configuration. The domain changes in this release have not been applied
to the VPS by the agent. The previous HTTP IP login repair passed on the VPS.

## Public URLs

| Purpose | URL |
| --- | --- |
| Application | `https://ideashop.zeacrm.com` |
| REST and first-party auth | `https://api.ideashop.zeacrm.com/api` |
| API health and readiness | `/api/health`, `/api/ready` on the backend host |
| API documentation | `https://api.ideashop.zeacrm.com/docs` |
| OpenAPI | `https://api.ideashop.zeacrm.com/openapi.json` |
| OAuth issuer | `https://api.ideashop.zeacrm.com/api/oauth2` |
| RFC 8414 discovery | `https://api.ideashop.zeacrm.com/.well-known/oauth-authorization-server/api/oauth2` |
| OAuth consent UI | `https://ideashop.zeacrm.com/#/oauth/authorize` |
| Password reset UI | `https://ideashop.zeacrm.com/#/reset-password` |
| Task/chat/ticket WebSockets | `wss://api.ideashop.zeacrm.com/api/ws/...` |
| Presence, calls and meetings | Socket.IO at `https://api.ideashop.zeacrm.com/socket.io/` |
| Local upload public base | `https://api.ideashop.zeacrm.com/uploads` |

OAuth management and its generated examples use the same API base. Password
recovery uses the new URL while retaining the existing SMTP configuration and
delivery controls. External storage endpoints, JWT/signing keys, SMTP credentials,
registered third-party OAuth callback URLs, and tenant data are preserved.

The frontend reads API, WebSocket, ticket and presence settings from
`runtime-config.js` before falling back to Vite build settings. No old public API
hostname is used as a frontend fallback. Unconfigured local development uses `/api`
and keeps its local presence fallback. Existing relative upload/avatar links remain
accessible through the frontend proxy.

## Publish the reviewed release

The domain helper and source must be committed/pushed through your existing release
process first. Review `git diff` and stage only this release's paths; do not stage
private `.env` files. Then update the VPS without resetting its working tree:

```bash
cd /opt/ideashop-zeaplay &&
git fetch origin &&
git switch main &&
git pull --ff-only origin main &&
bash ops/apply-live-domains.sh --prepare-proxy
```

This attaches the existing NPM container `nginx-proxy-npm-1` to the existing
application network and prints the required upstream. It does not recreate an
application service or change `.env.production`. Custom names can be supplied as
`ZEAPLAY_NPM_CONTAINER` and `ZEAPLAY_APP_NETWORK`.

## Nginx Proxy Manager

Create **two Proxy Hosts**, one per public hostname. Use these settings on both:

| Setting | Value |
| --- | --- |
| Domain | `ideashop.zeacrm.com` or `api.ideashop.zeacrm.com` |
| Upstream scheme | `http` |
| Forward hostname | `zeaplay_frontend` |
| Forward port | `80` |
| Websocket support | On |
| Cache Assets | Off (runtime configuration and service worker must revalidate) |
| Certificate | Valid for that exact hostname |
| Force SSL | On |

Use two certificates or one certificate explicitly including both names.
`*.zeacrm.com` alone does not cover `api.ideashop.zeacrm.com`.
Remove any old Custom Locations for `/api/`, `/oauth2/` or `/socket.io/` that send
traffic elsewhere or strip the API prefix. Keep NPM's normal Host and
X-Forwarded-Proto forwarding. For both hosts, disable access logging in Advanced
configuration (`access_log off;`) to avoid recording OAuth callback query strings.

Both hosts enter the existing gateway. Its frontend virtual host serves the app;
its API virtual host forwards root and `/api` aliases, OAuth discovery, uploads,
and native WebSockets to FastAPI and `/socket.io/` to presence. The API host root
returns API JSON rather than the frontend page. Database/Redis ports stay private.

Persist NPM's attachment to the existing application network in NPM's own Compose
configuration so replacement of the NPM container retains it. Keep all of NPM's
existing database/network attachments. For the observed project, the external
network is `ideashop-zeaplay_default`; the prepare command prints the actual name.
If NPM's private address changes, rerun the apply command to update the exact-peer
trust setting. The gateway does not trust public X-Forwarded-Proto headers.

## Apply and verify

After both hosts have working HTTPS certificates, run on the VPS:

```bash
cd /opt/ideashop-zeaplay
bash ops/apply-live-domains.sh --apply
```

The helper:

1. Checks both HTTPS health endpoints before changing application settings.
2. Confirms the current `/app/media` bind mount. The preceding HTTP repair already
   established this mount. A custom/missing mount stops deployment for review.
3. Backs up the private environment and PostgreSQL database, validates the dump,
   and retains the old backend/frontend/presence image references.
4. Atomically configures only the application-owned public URLs and origin/proxy
   settings. It preserves private settings, the existing media directory, storage
   providers, SMTP controls and keys. It selects the existing Compose project.
5. Builds and validates images, checks the existing presence/API signing
   configuration agrees without printing keys, and checks OAuth storage before
   restarting services. It does not install missing tables. Existing custom avatar
   files are copied, with the backend stopped, into a persistent bind directory
   when they were not already mounted.
6. Recreates backend, presence and frontend with
   `-f ops/deploy/live-domains.compose.yml`. PostgreSQL/Redis are not recreated;
   schema bootstrap remains disabled and no migration runs.
7. Checks real TLS, API readiness, OAuth discovery, browser CORS and presence routing.

The cutover removes HTTP IP and old-domain origins from the production browser
allowlists and sets `VEE_BROWSER_SESSION_HTTP_ORIGINS=[]`. Sign in at the new
frontend domain after deployment. The session cookie belongs only to the API host
and remains Secure, HttpOnly, SameSite=Lax, Path=/ with no Domain attribute.
Changing hostnames requires a fresh sign-in. Existing OAuth grants issued with a
different issuer require reauthorization; registered client callbacks are not
silently rewritten. Configure any callback owned by your integration explicitly
in its client registration/provider console.

Keep **`-f ops/deploy/live-domains.compose.yml`** in all later Compose up operations,
with both `ZEAPLAY_MEDIA_HOST_PATH` and `ZEAPLAY_AVATAR_HOST_PATH` retained in the
private environment. Do not run the old HTTP repair helper after the HTTPS cutover.

You can repeat credential-free verification at any time:

```bash
python3 ops/verify-live-domains.py
```

Expect `passed: true`. Anonymous refresh and deliberately invalid login should
return **401**, not 403/400. Then test an existing account's login and reload.
Browser push subscriptions belong to the new frontend origin: enable that browser
again after signing in. Preserve the existing VAPID pair. This release does not
enable SMTP, send email/push, or rotate credentials.

## Validation evidence

| Check | Result |
| --- | --- |
| Frontend/backend production image builds | PASS |
| Frontend tests | 133 passed |
| Focused backend settings/auth/OAuth/deployment tests | 96 passed |
| Presence tests | 9 passed, 1 integration case skipped |
| Real TLS/API/CORS/discovery/presence routing | 18 passed |
| Chrome login, session, native WebSocket, Socket.IO and PKCE flows | 9 passed |
| Runtime endpoint JSON, escaping and control-character rejection | 4 passed |
| Endpoint TypeScript module | PASS |
| Compose media/avatar mounts and missing-path refusal | PASS |
| VPS domain TLS before deployment | Pending NPM hosts/certificates |

Backend pytest variants for PostgreSQL were deselected in the Windows run; the
separate full-stack integration uses real PostgreSQL 15/Redis on Linux. The
presence suite's skipped signaling scenario is separate from the real browser
presence authentication check, which passed. The frontend build retains existing
Node 18 dependency engine/deprecation warnings. The earlier
[full backend audit](../backend-audit-2026-10-21/README.md) remains separate.

`checks/` contains image builds, frontend/backend tests, presence tests and an
isolated PostgreSQL 15/Redis integration using the real two-host TLS proxy chain.
The browser test uses the exact public hostnames through a proxy restricted to its
owned test network and trusts only its generated certificate's public key. Python
TLS checks validate the generated CA, hostnames and chain without disabling TLS
verification. No system DNS/hosts file or existing service is modified.

This local verification does not certify the VPS certificates or an actual user's
production login. The live domain verifier must pass after the NPM/deployment steps.
