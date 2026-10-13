from __future__ import annotations

from .base import Notifier
from .webex import WebexNotifier

_notifier: Notifier = WebexNotifier()


def get_notifier() -> Notifier:
    return _notifier
