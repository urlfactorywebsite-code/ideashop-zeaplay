#!/bin/sh
set -efu

# Empty by default: public clients cannot assert that their HTTP connection used TLS.
# Nginx validates the address/CIDR syntax during startup; reject config injection here.
output=/etc/nginx/conf.d/00-trusted-proxy.conf
{
  printf 'geo $zea_trusted_proxy {\n  default 0;\n'
  previous_ifs=$IFS
  IFS=,
  for peer in ${NGINX_TRUSTED_PROXY_CIDRS:-}; do
    case "$peer" in
      ''|*[!0-9a-fA-F:./]*|*/0)
        printf 'Invalid NGINX_TRUSTED_PROXY_CIDRS entry\n' >&2
        exit 1
        ;;
    esac
    printf '  %s 1;\n' "$peer"
  done
  IFS=$previous_ifs
  printf '}\n'
} > "$output"
