from __future__ import annotations

import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class WebexNotifier:
    def __init__(self) -> None:
        self._settings = get_settings()

    def send_webex_message(self, message: str) -> None:
        token = self._settings.webex_bot_token
        room_id = self._settings.webex_room_id
        if not token or not room_id:
            return

        try:
            with httpx.Client(timeout=10.0) as client:
                client.post(
                    f"{self._settings.webex_api_base}/messages",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"roomId": room_id, "markdown": message},
                )
        except Exception as exc:  # pragma: no cover - network failure should not crash request
            logger.warning("Failed to send Webex message: %s", exc)
