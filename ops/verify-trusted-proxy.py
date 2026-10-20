"""Verify the real nginx -> Uvicorn -> browser-session origin/HTTPS guard in owned containers."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


def docker(*args):
    result = subprocess.run(["docker", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def status(url, headers=None, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    try:
        response = urlopen(Request(url, headers=headers or {}, data=data), timeout=2)
    except HTTPError as error:
        response = error
    with response:
        return response.status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run = "zea-proxy-check-" + uuid4().hex[:12]
    containers, results = [], []
    origin = "https://todoplay.urlfactory.website"
    with tempfile.TemporaryDirectory(prefix="zea-proxy-check-") as scratch:
        app = Path(scratch) / "probe.py"
        app.write_text('''from fastapi import FastAPI, Request, HTTPException
from app.services.browser_session import check_origin
app = FastAPI()
@app.get('/health')
def health(): return {'status': 'ok'}
@app.post('/auth/browser-session/refresh')
@app.post('/auth/login')
def session(request: Request):
    check_origin(request)
    raise HTTPException(401, 'Synthetic probe: no session or valid credentials')
''')
        try:
            docker("network", "create", run)
            config = json.loads(docker("network", "inspect", run))[0]["IPAM"]["Config"][0]
            subnet, gateway = config["Subnet"], config["Gateway"]
            backend = run + "-backend"
            containers.append(backend)
            docker("run", "-d", "--name", backend, "--network", run,
                   "--network-alias", "backend", "--network-alias", "presence",
                   "--mount", f"type=bind,source={app},target=/tmp/probe.py,readonly",
                   "-w", "/tmp", "-e", "VEE_BOOTSTRAP_SCHEMA=false", "-e", "VEE_DATABASE_URL=sqlite:///:memory:",
                   "-e", "VEE_ENVIRONMENT=production", "-e", "VEE_CORS_ALLOW_ORIGINS=" + json.dumps([origin]),
                   "-e", "VEE_JWT_SECRET_KEY=synthetic-proxy-access-key-00000000000000000",
                   "-e", "VEE_JWT_REFRESH_SECRET_KEY=synthetic-proxy-refresh-key-0000000000000000",
                   "-e", "PYTHONPATH=/app", "-e", "FORWARDED_ALLOW_IPS=" + subnet,
                   args.backend_image, "python", "-m", "uvicorn", "probe:app", "--host", "0.0.0.0", "--port", "6311")
            for trusted in (True, False):
                frontend = run + ("-trusted" if trusted else "-untrusted")
                containers.append(frontend)
                command = ["run", "-d", "--name", frontend, "--network", run, "-p", "127.0.0.1::80"]
                if trusted:
                    command += ["-e", "NGINX_TRUSTED_PROXY_CIDRS=" + gateway + "/32"]
                docker(*command, args.frontend_image)
                mapping = json.loads(docker("inspect", frontend))[0]["NetworkSettings"]["Ports"]["80/tcp"][0]
                base = "http://127.0.0.1:" + mapping["HostPort"]
                deadline = time.monotonic() + 25
                while True:
                    try:
                        if status(base + "/api/health") == 200:
                            break
                    except (URLError, TimeoutError, ConnectionError):
                        pass
                    if time.monotonic() > deadline:
                        raise RuntimeError("Disposable proxy did not become ready: " + docker("logs", frontend))
                    time.sleep(0.1)
                common = {"Origin": origin, "X-Zea-Browser": "1", "Content-Type": "application/json"}
                cases = [("HTTPS refresh", "/auth/browser-session/refresh", {**common, "X-Forwarded-Proto": "https"}, 401 if trusted else 400),
                         ("HTTPS login", "/auth/login", {**common, "X-Forwarded-Proto": "https"}, 401 if trusted else 400),
                         ("Plain HTTP denied", "/auth/login", common, 400),
                         ("Foreign origin denied", "/auth/login", {**common, "Origin": "https://untrusted.example", "X-Forwarded-Proto": "https"}, 403),
                         ("Malformed scheme denied", "/auth/login", {**common, "X-Forwarded-Proto": "https,http"}, 400)]
                for name, path, headers, expected in cases:
                    actual = status(base + "/api" + path, headers, {})
                    results.append({"proxy_peer_trusted": trusted, "case": name, "status": actual,
                                    "expected": expected, "passed": actual == expected})
            for name, peers, expected in [
                ("No configured peers", "", 0),
                ("Bounded IPv4 and IPv6 peers", "127.0.0.1/32,::1/128", 0),
                ("Universal proxy trust denied", "0.0.0.0/0", 1),
                ("Nginx directive injection denied", "127.0.0.1;server{}", 1),
            ]:
                probe = subprocess.run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "/bin/sh",
                    "-e", "NGINX_TRUSTED_PROXY_CIDRS=" + peers, args.frontend_image,
                    "/docker-entrypoint.d/20-trusted-proxy.sh"], capture_output=True)
                results.append({"case": name, "exit_code": probe.returncode, "expected": expected,
                                "passed": probe.returncode == expected})
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({"passed": all(row["passed"] for row in results), "checks": results}, indent=2))
            print(json.dumps({"passed": sum(row["passed"] for row in results), "total": len(results)}))
            return 0 if all(row["passed"] for row in results) else 1
        finally:
            for container in reversed(containers):
                subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            subprocess.run(["docker", "network", "rm", run], capture_output=True)


if __name__ == "__main__":
    raise SystemExit(main())
