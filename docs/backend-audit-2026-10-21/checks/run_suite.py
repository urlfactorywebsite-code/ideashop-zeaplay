"""Audit runner: disposable working directory, explicit synthetic configuration."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.app.config import Settings

checks = Path(__file__).parent
label, *extra = sys.argv[1:]
scratch = Path(tempfile.mkdtemp(prefix="zeaplay-audit-suite-"))
(scratch / "assets").mkdir()
env = {key: value for key, value in os.environ.items()
       if not key.startswith(("VEE_", "VAPID_", "ZEAPLAY_", "PROMETHEUS_"))}
ambient_settings = {key: os.environ.pop(key) for key in list(os.environ)
                    if key.startswith(("VEE_", "VAPID_"))}
try:
    defaults = Settings(_env_file=None).model_dump()
finally:
    os.environ.update(ambient_settings)
for key, value in defaults.items():
    env["VEE_" + key.upper()] = (json.dumps(value) if isinstance(value, (list, dict, bool))
                                else "" if value is None else str(value))
env.update(PYTHONPATH=os.pathsep.join([str(ROOT), str(ROOT / "backend")]), PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
           VEE_DATABASE_URL="sqlite:///" + (scratch / "application.db").as_posix(),
           VEE_BOOTSTRAP_SCHEMA="false", VEE_MEDIA_ROOT=str(scratch / "media"),
           VEE_CACHE_PREFIX="backend-audit", VEE_BCRYPT_ROUNDS="4",
           VEE_ENABLE_N8N_FORWARDING="false", VAPID_PRIVATE_KEY="", VAPID_PUBLIC_KEY="", VAPID_SUBJECT="",
           ZEAPLAY_RT_POSTGRES_TEST_URL=os.getenv("AUDIT_POSTGRES_URL", "postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test"),
           ZEAPLAY_RT_WORKER_POSTGRES_TEST_URL=os.getenv("AUDIT_POSTGRES_URL", "postgresql+psycopg2://rt_test@127.0.0.1:56415/zeaplay_rt3_test"),
           ZEAPLAY_RT_REDIS_TEST_URL=os.getenv("AUDIT_REDIS_URL", "redis://127.0.0.1:56379/15"),
           ZEAPLAY_WORK_TEST_REDIS_URL=os.getenv("AUDIT_REDIS_URL", "redis://127.0.0.1:56379/14"))
if os.getenv("AUDIT_BACKUP_CONTAINER", "zeaplay-journey-review-postgres-1"):
    env["ZEAPLAY_RT_BACKUP_CONTAINER"] = os.getenv("AUDIT_BACKUP_CONTAINER", "zeaplay-journey-review-postgres-1")
if os.getenv("AUDIT_REDIS_SERVER_ARGV"):
    env["ZEAPLAY_RT_REDIS_SERVER_ARGV"] = os.environ["AUDIT_REDIS_SERVER_ARGV"]
if os.getenv("AUDIT_K6_BINARY"):
    env["ZEAPLAY_RT_K6_BINARY"] = os.environ["AUDIT_K6_BINARY"]
args = [sys.executable, "-m", "pytest", str(ROOT / "backend/tests"), "-q", "-ra",
        "--tb=short", "--timeout=90", "-o", "cache_dir=" + str(scratch / "pytest-cache"),
        "--junitxml=" + str(checks / (label + ".xml")),
        "--cov=backend.app", "--cov-report=json:" + str(checks / (label + "-coverage.json")),
        "--cov-report=term:skip-covered", *extra]
with (checks / (label + ".txt")).open("w", encoding="utf-8") as log:
    result = subprocess.run(args, cwd=scratch, env=env, stdout=log, stderr=subprocess.STDOUT)
(checks / (label + "-status.json")).write_text(json.dumps({"exit_code": result.returncode,
    "working_directory": str(scratch), "python": sys.version, "args": args}, indent=2))
print(json.dumps({"label": label, "exit_code": result.returncode, "log": str(checks / (label + ".txt"))}))
sys.exit(result.returncode)
