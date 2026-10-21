#!/bin/sh
set -eu

RUNTIME_FILE="/usr/share/nginx/html/runtime-config.js"
escape_json() {
  if [ "$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177')" != "$1" ]; then
    printf 'Runtime endpoint contains a control character\n' >&2
    exit 1
  fi
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

API_VALUE=$(escape_json "${API_URL:-}")
PRESENCE_VALUE=$(escape_json "${PRESENCE_URL:-}")
CHAT_VALUE=$(escape_json "${CHAT_URL:-${PRESENCE_URL:-}}")
WS_VALUE=$(escape_json "${WS_URL:-}")
TICKET_VALUE=$(escape_json "${TICKET_CHAT_WS_URL:-}")
printf 'window.__RUNTIME_CONFIG__ = {"API_URL":"%s","PRESENCE_URL":"%s","CHAT_URL":"%s","WS_URL":"%s","TICKET_CHAT_WS_URL":"%s"};\n' \
  "$API_VALUE" "$PRESENCE_VALUE" "$CHAT_VALUE" "$WS_VALUE" "$TICKET_VALUE" > "$RUNTIME_FILE"
