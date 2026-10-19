"""Static release safeguards; no application containers are built or restarted."""
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]


def test_backend_build_excludes_runtime_secrets_and_private_evidence():
    patterns = set((ROOT / "backend/.dockerignore").read_text().splitlines())
    assert {".env", ".env.*", "media", "uploads", "*.pem", "*.key",
            "credentials*.json", "service-account*.json"} <= patterns


def test_release_image_override_requires_explicit_tags():
    override = (ROOT / "ops/deploy/task-journey-images.compose.yml").read_text()
    assert "${ZEAPLAY_BACKEND_RELEASE_IMAGE:?" in override
    assert "${ZEAPLAY_FRONTEND_RELEASE_IMAGE:?" in override


def test_persistent_media_override_is_opt_in_and_refuses_missing_source(tmp_path):
    if not shutil.which("docker"):
        pytest.skip("Docker Compose CLI is required for release configuration validation")
    environment = {**os.environ, "ZEAPLAY_ENV_FILE": ".env.production.example"}
    environment.pop("ZEAPLAY_MEDIA_HOST_PATH", None)
    args = ["docker", "compose", "--env-file", ".env.production.example", "-f", "docker-compose.prod.yml",
            "-f", "ops/deploy/task-journey-media.compose.yml", "config", "--format", "json", "--no-env-resolution"]
    rejected = subprocess.run(args, cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30)
    assert rejected.returncode != 0 and "ZEAPLAY_MEDIA_HOST_PATH" in rejected.stderr
    environment["ZEAPLAY_MEDIA_HOST_PATH"] = str(tmp_path)
    result = subprocess.run(args, cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    backend = json.loads(result.stdout)["services"]["backend"]
    assert backend["environment"]["VEE_MEDIA_ROOT"] == "/app/media"
    mounts = [row for row in backend["volumes"] if row["target"] == "/app/media"]
    assert len(mounts) == 1 and mounts[0]["type"] == "bind"
    assert mounts[0]["bind"]["create_host_path"] is False
    assert not json.loads(subprocess.check_output(
        ["docker", "compose", "--env-file", ".env.production.example", "-f", "docker-compose.prod.yml",
         "config", "--format", "json", "--no-env-resolution"], cwd=ROOT, env=environment))["services"]["backend"].get("volumes")
