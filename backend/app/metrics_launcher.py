"""Container entrypoint: initialize a private metrics directory before imports."""
import os
from pathlib import Path
import sys


def main():
    directory = Path("/tmp/zeaplay-prometheus")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.getuid():
        raise SystemExit("Unsafe metrics directory")
    directory.chmod(0o700)
    # One launcher per container. Never share this directory between replicas.
    for file in directory.glob("*.db"):
        file.unlink()
    os.environ["PROMETHEUS_MULTIPROC_DIR"] = str(directory)
    os.execvp(sys.executable, [sys.executable, "-m", "uvicorn", *sys.argv[1:]])


if __name__ == "__main__":
    main()
