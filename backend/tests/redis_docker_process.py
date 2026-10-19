"""Owned disposable Redis process adapter for the restart regression fixture."""
import argparse
import subprocess
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--bind", choices=["127.0.0.1"], required=True)
    parser.add_argument("--save", choices=[""], required=True)
    parser.add_argument("--appendonly", choices=["no"], required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Expected an ephemeral local port")
    name = "zeaplay-rt4-owned-redis-" + uuid4().hex
    try:
        return subprocess.call(["docker", "run", "--rm", "--name", name, "-p", f"127.0.0.1:{args.port}:6379",
                                "redis:7-alpine", "redis-server", "--bind", "0.0.0.0", "--port", "6379", "--save", "", "--appendonly", "no"])
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
