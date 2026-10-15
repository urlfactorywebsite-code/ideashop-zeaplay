from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_frontend_nginx_proxies_native_and_socketio_websockets():
    config = (ROOT / "frontend" / "nginx.conf").read_text()

    assert "location /api/ws/" in config
    assert "proxy_pass http://backend:6311/ws/" in config
    assert "location /socket.io/" in config
    assert "proxy_pass http://presence:6312/socket.io/" in config
    assert "proxy_set_header Upgrade $http_upgrade;" in config
    assert "proxy_read_timeout 3600s;" in config
    assert "access_log off;" in config


def test_production_compose_keeps_internal_services_on_loopback():
    compose = (ROOT / "docker-compose.prod.yml").read_text()

    assert '      - "6300:80"' in compose
    assert '      - "127.0.0.1:6311:6311"' in compose
    assert '      - "127.0.0.1:6312:6312"' in compose
    assert "      PRESENCE_CORS_ORIGINS: ${PRESENCE_CORS_ORIGINS}" in compose
    assert "      PRESENCE_REQUIRE_ORIGIN: ${PRESENCE_REQUIRE_ORIGIN}" in compose
    assert "      PRESENCE_ALLOW_LOCALHOST_ORIGINS: ${PRESENCE_ALLOW_LOCALHOST_ORIGINS}" in compose
    assert "      PRESENCE_MAX_CONNECTIONS_PER_USER: ${PRESENCE_MAX_CONNECTIONS_PER_USER}" in compose
    assert "      PRESENCE_MAX_TOTAL_CONNECTIONS: ${PRESENCE_MAX_TOTAL_CONNECTIONS}" in compose
