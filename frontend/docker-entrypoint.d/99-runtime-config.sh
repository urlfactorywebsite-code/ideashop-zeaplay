#!/bin/sh
set -eu

RUNTIME_FILE="/usr/share/nginx/html/runtime-config.js"
PRESENCE_VALUE="${PRESENCE_URL:-}"

ESCAPED_VALUE=$(printf '%s' "$PRESENCE_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > "$RUNTIME_FILE" <<EOF
window.__RUNTIME_CONFIG__ = { PRESENCE_URL: "${ESCAPED_VALUE}" };
EOF
