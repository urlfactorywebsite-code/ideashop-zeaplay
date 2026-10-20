"""Validation shared by subscription input and the outbound delivery boundary."""
from __future__ import annotations

import base64
import re
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric import ec


# Browser push endpoints are opaque capabilities. Never allow an arbitrary URL to
# turn authenticated subscription registration into a server-side HTTP proxy.
PUSH_PROVIDER_HOSTS = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
    "notify.live.net",
)


def validate_push_endpoint(value: str) -> str:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if (
            len(value) > 4096
            or value != value.strip()
            or any(ord(char) < 33 for char in value)
            or "\\" in value
            or parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or parsed.port not in (None, 443)
            or not any(host == provider or host.endswith("." + provider) for provider in PUSH_PROVIDER_HOSTS)
        ):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Subscription endpoint must use a supported browser push provider over HTTPS") from None
    return value


def decode_push_key(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}", value):
        raise ValueError("Invalid subscription key encoding")
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError:
        raise ValueError("Invalid subscription key encoding") from None


def validate_push_public_key(value: str) -> str:
    decoded = decode_push_key(value)
    if len(decoded) != 65 or decoded[0] != 4:
        raise ValueError("Subscription public key must be an uncompressed P-256 key")
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decoded)
    except ValueError:
        raise ValueError("Subscription public key is invalid") from None
    return value


def validate_push_auth(value: str) -> str:
    if len(decode_push_key(value)) != 16:
        raise ValueError("Subscription authentication secret must contain 16 bytes")
    return value
