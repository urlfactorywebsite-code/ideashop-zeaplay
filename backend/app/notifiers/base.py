from __future__ import annotations

from typing import Protocol


class Notifier(Protocol):
    def send_webex_message(self, message: str) -> None:
        ...
