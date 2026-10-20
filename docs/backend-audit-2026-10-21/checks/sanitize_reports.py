"""Normalize report encoding and remove credentials, including synthetic JWTs."""
import os
from pathlib import Path
import re

root = Path(__file__).resolve().parent
ambient = [value for key, value in os.environ.items()
           if re.search(r"TOKEN|SECRET|PASSWORD|API.?KEY|CREDENTIAL", key, re.I) and len(value) >= 12]
changed = 0
for path in root.iterdir():
    if path.suffix not in {".txt", ".xml", ".json"} or not path.is_file():
        continue
    raw = path.read_bytes()
    content = raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig", errors="replace")
    for secret in ambient:
        content = content.replace(secret, "[REDACTED_SECRET]")
    content = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED_SECRET]", content)
    content = re.sub(r'''((?:["'])(?:VAPID_PRIVATE_KEY|client_secret|hashed_password|access_token|refresh_token|password)(?:["'])\s*:\s*)(["'])([^"'\r\n]+)\2''',
                     lambda match: match[1] + match[2] + "[REDACTED_SECRET]" + match[2], content)
    normalized = content.encode("utf-8")
    if normalized != raw:
        path.write_bytes(normalized)
        changed += 1
print(f"Sanitized/normalized {changed} report files.")
