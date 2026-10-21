"""Retry unreferenced avatar cleanup. Read-only unless --apply is specified."""
import argparse
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .avatar_utils import cleanup_unused_avatar
from .database import engine
from .tickets import models as ticket_models  # noqa: F401 - register related ORM tables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    with Session(engine) as db:
        candidates = db.scalars(select(models.AvatarAsset.id).where(
            models.AvatarAsset.is_default.is_(False),
            models.AvatarAsset.created_at < cutoff,
            ~models.AvatarAsset.users.any())).all()
    print(f'{len(candidates)} unreferenced avatar records older than one hour')
    if args.apply:
        for asset_id in candidates:
            with Session(engine) as db:
                try:
                    cleanup_unused_avatar(db, asset_id)
                    db.commit()
                except Exception:  # noqa: BLE001 - keep records available for a later retry
                    db.rollback()
                    print(f'Cleanup deferred: {asset_id}')


if __name__ == '__main__':
    main()
