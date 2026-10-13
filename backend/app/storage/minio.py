"""MinIO S3 client helpers and object key generation."""

from __future__ import annotations

import os
import re
from datetime import datetime
from functools import lru_cache
from uuid import uuid4

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
except ModuleNotFoundError:
    boto3 = None
    Config = None
    ClientError = None

from ..config import get_settings

_FILENAME_CLEANUP = re.compile(r"[^A-Za-z0-9._-]+")
_SEGMENT_CLEANUP = re.compile(r"[^A-Za-z0-9_-]+")


def _sanitize_segment(value: str, *, fallback: str) -> str:
    cleaned = _SEGMENT_CLEANUP.sub("-", value or "").strip("-_")
    cleaned = cleaned.replace("..", "")
    return cleaned or fallback


def sanitize_filename(filename: str, *, fallback: str = "file") -> str:
    if not filename:
        return fallback

    normalized = filename.replace("\\", "/")
    base_name = normalized.split("/")[-1].strip().strip(".")
    if not base_name:
        return fallback

    stem, ext = os.path.splitext(base_name)
    safe_stem = _FILENAME_CLEANUP.sub("-", stem).strip("-_.").replace("..", "")
    safe_ext = _FILENAME_CLEANUP.sub("", ext.lstrip(".")).lower()

    if not safe_stem:
        safe_stem = fallback

    return f"{safe_stem}.{safe_ext}" if safe_ext else safe_stem


def build_media_object_key(
    *,
    workspace: str | None,
    department_id: str | None,
    user_id: str,
    media_type: str,
    filename: str,
    now: datetime | None = None,
) -> str:
    timestamp = now or datetime.utcnow()
    safe_workspace = _sanitize_segment(workspace or "global", fallback="global")
    safe_department = _sanitize_segment(department_id or "none", fallback="none")
    safe_user = _sanitize_segment(user_id, fallback="user")
    safe_type = _sanitize_segment(media_type, fallback="file")
    safe_filename = sanitize_filename(filename)
    unique = uuid4().hex

    return (
        f"media/{safe_workspace}/{safe_department}/{safe_user}/"
        f"{safe_type}/{timestamp:%Y}/{timestamp:%m}/{unique}_{safe_filename}"
    )


def build_ticket_attachment_key(*, tenant_id: str, ticket_id: str, filename: str) -> str:
    safe_tenant = _sanitize_segment(tenant_id, fallback="tenant")
    safe_ticket = _sanitize_segment(ticket_id, fallback="ticket")
    safe_filename = sanitize_filename(filename)
    unique = uuid4()
    return f"tenant/{safe_tenant}/tickets/{safe_ticket}/{unique}-{safe_filename}"


@lru_cache
def get_minio_client():
    settings = get_settings()
    if boto3 is None or Config is None:
        raise RuntimeError("boto3 is required for MinIO support. Install backend requirements.")
    if not settings.minio_endpoint:
        raise RuntimeError("MinIO endpoint is not configured")
    if not settings.minio_access_key or not settings.minio_secret_key:
        raise RuntimeError("MinIO access key/secret are not configured")

    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name=settings.minio_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def ensure_bucket_exists(client, bucket: str) -> None:
    if not bucket:
        raise RuntimeError("MinIO bucket is not configured")
    if ClientError is None:
        raise RuntimeError("botocore is required for MinIO support")
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchBucket", "NotFound"}:
            client.create_bucket(Bucket=bucket)
            return
        raise
