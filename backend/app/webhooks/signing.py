from __future__ import annotations

import hashlib
import hmac


def generate_signature(secret: str, body: bytes) -> str:
    # Verification: compute HMAC SHA256 hex digest of the raw request body with the shared secret,
    # then compare against the X-Zea-Signature header using a constant-time compare.
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
