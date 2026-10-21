# HTTP IP browser-session repair verification

Target: `http://167.86.108.178:6300/`. Source changes remain local and undeployed.
Use [the VPS instructions](../vps-http-login.md) to enable the explicit exception,
preserve current uploads, and recreate only the backend.

| Check | Result | Evidence |
| --- | --- | --- |
| Production backend image build | PASS | `checks/backend-build.txt` |
| Windows Python 3.14 focused settings/auth/OAuth tests on disposable SQLite | 83 passed | `checks/windows-final.txt`, `checks/windows-final.xml` |
| Linux Python 3.11 full app through nginx, PostgreSQL 15 and Redis | 20 passed | `checks/docker-http.json` |
| HTTPS proxy/default policy regression checks | 14 passed | `checks/https-proxy.json` |
| Production Compose configuration | PASS | Checked with `.env.production.example` and `--no-env-resolution` |
| VPS deployment helper syntax and private-setting preservation | PASS | `checks/deploy-helper.json`; 3 environment formats plus invalid-input preservation |
| VPS before deployment | Health 200, login/refresh 403 | `checks/vps-before-deploy.json` |

The HTTP integration runs the built backend's real `app.main:app`, real authentication
routes, a synthetic user, real cookies, and the production frontend nginx. It checks
database/readiness, credentialed CORS and preflight, anonymous/invalid requests,
successful login, session restore, access-token authentication, exact origin/port
and browser marker rejection, logout, and post-logout rejection.

Unit/regression tests also check malformed/wildcard/hostname HTTP exceptions,
default HTTPS enforcement, unchanged OAuth HTTPS requirements, distinct cookies
for different ports, and rejection of the HTTP cookie when switching to HTTPS.
PostgreSQL pytest variants were deselected in the Windows run; real PostgreSQL 15
is exercised by the separate Linux Docker integration. The 14 proxy checks use
the real production browser-session guard in disposable Uvicorn/nginx containers.

All owned test containers/networks and temporary PostgreSQL data were removed.
No business database, existing local service, or VPS configuration was changed.
No message or email was sent. This is focused repair verification; the earlier
[full backend audit](../backend-audit-2026-10-21/README.md) remains separate, with
its previously documented failures unresolved by this change.

`bash ops/apply-http-login.sh` automates the VPS repair after the helper and source
have been published/pulled. The helper itself has not been run on the VPS.
