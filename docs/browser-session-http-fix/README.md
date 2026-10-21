# HTTP IP browser-session repair verification

Historical target: `http://167.86.108.178:6300/`. The user applied this repair on
the VPS and its credential-free checks passed. The subsequent
[HTTPS domain cutover](../live-domains/README.md) uses the new live hostnames.

| Check | Result | Evidence |
| --- | --- | --- |
| Production backend image build | PASS | `checks/backend-build.txt` |
| Windows Python 3.14 focused settings/auth/OAuth tests on disposable SQLite | 83 passed | `checks/windows-final.txt`, `checks/windows-final.xml` |
| Linux Python 3.11 full app through nginx, PostgreSQL 15 and Redis | 20 passed | `checks/docker-http.json` |
| HTTPS proxy/default policy regression checks | 14 passed | `checks/https-proxy.json` |
| Production Compose configuration | PASS | Checked with `.env.production.example` and `--no-env-resolution` |
| VPS deployment helper syntax and private-setting preservation | PASS | `checks/deploy-helper.json`; 3 environment formats plus invalid-input preservation |
| VPS before deployment | Health 200, login/refresh 403 | `checks/vps-before-deploy.json` |
| VPS after user deployment | Health/schema 200, anonymous refresh/invalid login 401 | `../live-domains/checks/vps-http-working.json` |

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
Local tests did not change a business database or existing local service. The
user subsequently ran the backed-up VPS repair, preserving the existing uploads;
the agent independently verified the public health and origin checks. No real
account login was tested by the agent. No message or email was sent. This is
focused repair verification; the earlier
[full backend audit](../backend-audit-2026-10-21/README.md) remains separate, with
its previously documented failures unresolved by this change.

`bash ops/apply-http-login.sh` was run successfully by the user. Do not rerun it
after the HTTPS domain cutover, because it restores the temporary HTTP exception.
