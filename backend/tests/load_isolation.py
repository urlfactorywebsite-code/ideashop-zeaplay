"""Optional fixture proof for the test-only gateway. Never imported by app.main."""
import json
import os
from pathlib import Path


def install(app):
    path = os.environ.get("ZEAPLAY_RT_LOAD_ISOLATION_FILE")
    if not path:
        return
    from backend.app.config import get_settings
    settings = get_settings()
    if ("rt3_test" not in settings.database_url or not settings.cache_prefix.startswith("rt3-test-")
            or settings.bootstrap_schema or settings.enable_n8n_forwarding):
        raise RuntimeError("Load proof requires the dedicated scratch database and namespace")
    proof = json.loads(Path(path).read_text())
    if not proof.get("nonce") or not proof.get("runId") or not isinstance(proof.get("accounts"), list):
        raise RuntimeError("Invalid owned load fixture proof")

    # Preserve business persistence and auth; disable only test egress boundaries.
    from backend.app import email_utils
    from backend.app.emails import smtp
    from backend.app.services import notification_dispatcher
    from backend.app.webhooks import service
    def blocked(*args, **kwargs):
        return None
    email_utils._send_email_with_config = blocked
    smtp.send_ticket_event_email = blocked
    notification_dispatcher.push_if_enabled = blocked
    service.queue_event = lambda *args, **kwargs: []

    async def isolation():
        return {**proof, "outboundDeliveryBlocked": True}
    app.add_api_route("/api/__test__/realtime-isolation", isolation, methods=["GET"])
    app.add_api_route("/__test__/realtime-isolation", isolation, methods=["GET"])
