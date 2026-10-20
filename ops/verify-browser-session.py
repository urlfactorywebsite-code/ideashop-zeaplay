"""Check browser login routing without credentials or an existing session."""
import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def request(base, path, origin, payload=None):
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        headers.update({"Origin": origin, "X-Zea-Browser": "1", "Content-Type": "application/json"})
        data = json.dumps(payload).encode()
    try:
        response = urlopen(Request(base + path, data=data, headers=headers), timeout=15)
    except HTTPError as error:
        response = error
    except URLError as error:
        return {"path": path, "status": None, "error": str(error.reason)}
    with response:
        try:
            body = json.loads(response.read())
        except (ValueError, UnicodeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        result = {"path": path, "status": response.status}
        if isinstance(body.get("detail"), str):
            result["detail"] = body["detail"]
        if "paths" in body:
            paths = body["paths"]
            result["documented_paths"] = len(paths)
            result["browser_session_routes"] = [name for name in paths if "browser-session" in name]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Frontend origin, including scheme and optional port")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    url = urlsplit(base)
    if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        parser.error("--base must be an HTTP(S) origin without credentials, a path, query, or fragment")
    checks = [request(base, "/api/health", base), request(base, "/api/openapi.json", base),
              request(base, "/api/auth/browser-session/refresh", base, {}),
              request(base, "/api/auth/login", base,
                      {"email": "browser-origin-probe@example.invalid", "password": "synthetic-invalid-probe"})]
    routes = checks[1].get("browser_session_routes", [])
    has_sessions = all(any(route.endswith("/auth/browser-session/" + action) for route in routes)
                       for action in ("refresh", "logout"))
    passed = checks[0]["status"] == 200 and checks[1]["status"] == 200 and has_sessions and all(
        check["status"] == 401 for check in checks[2:])
    print(json.dumps({"origin": base, "passed": passed, "checks": checks,
        "expected": "Health/schema 200; refresh without a cookie and login with invalid synthetic credentials both 401",
        "diagnosis": {"403": "Origin rejected", "400": "HTTPS/proxy scheme rejected",
                      "404": "Missing route or different/stale upstream"}}, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
