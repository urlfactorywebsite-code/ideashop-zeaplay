"""Redact ambient secret values from generated local verification reports only."""
import os
from pathlib import Path
import re


def main():
    root = Path(__file__).resolve().parents[2] / "benchmarks" / "realtime" / "results"
    secrets = [value for key, value in os.environ.items()
               if re.search(r"TOKEN|SECRET|PASSWORD|API.?KEY|(?:^|_)KEY(?:_|$)|CREDENTIAL|CONNECTION_STRING", key, re.I) and len(value) >= 12]
    changed = 0
    for file in root.glob("*"):
        if file.is_symlink() or file.suffix not in {".xml", ".log", ".json"} or file.resolve().parent != root.resolve():
            continue
        content = file.read_text(encoding="utf-8")
        sanitized = content
        for secret in secrets:
            sanitized = sanitized.replace(secret, "[REDACTED_SECRET]")
        if sanitized != content:
            file.write_text(sanitized, encoding="utf-8")
            changed += 1
    print(f"Generated verification reports sanitized: {changed}")


if __name__ == "__main__":
    main()
