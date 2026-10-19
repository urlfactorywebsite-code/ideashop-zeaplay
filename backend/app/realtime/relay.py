"""Run independently: python -m app.realtime.relay [--once | --metrics]."""
import argparse
import json
import logging
import signal
import threading
import time
from datetime import datetime, timezone

from ..config import get_settings
from ..database import SessionLocal
from .outbox import backlog, prune, relay_batch
from ..models import RealtimeOutbox


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--metrics", action="store_true")
    parser.add_argument("--retry-dead", metavar="EVENT_ID")
    parser.add_argument("--metrics-port", type=int, default=0)
    args = parser.parse_args()
    if not get_settings().realtime_outbox_enabled:
        raise SystemExit("Enable VEE_REALTIME_OUTBOX_ENABLED after applying the additive migration")
    exporter = None
    if args.metrics_port:
        from ..observability import start_relay_metrics_server
        exporter = start_relay_metrics_server(args.metrics_port)
    try:
        return _run(args)
    finally:
        if exporter:
            server, worker = exporter
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


def _run(args):
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    logging.basicConfig(level=logging.INFO)
    next_prune = 0.0
    while not stop.is_set():
        processed = 0
        try:
            with SessionLocal() as db:
                if args.retry_dead:
                    row = db.get(RealtimeOutbox, args.retry_dead)
                    if row is None or row.status != "DEAD":
                        raise SystemExit("Expected an existing DEAD event")
                    row.status = "PENDING"
                    row.attempt_count = 0
                    row.next_attempt_at = datetime.now(timezone.utc)
                    row.last_error = None
                    db.commit()
                    return
                if args.metrics:
                    print(json.dumps(backlog(db)))
                    return
                processed = relay_batch(db)
                if time.monotonic() >= next_prune:
                    prune(db)
                    next_prune = time.monotonic() + 60
        except Exception as exc:
            logging.warning("realtime.relay_failed error=%s", type(exc).__name__)
            if args.once:
                raise
        if args.once:
            return
        if not processed:
            stop.wait(1)


if __name__ == "__main__":
    main()
