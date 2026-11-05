"""Serialize shared scoring balances and refresh preloaded ORM snapshots."""
from sqlalchemy import select

from .. import models


def lock_scoring_users(db, identifiers):
    # All scorers use the same order, including creator penalties and badge XP.
    # Flush earlier events in this transaction before refreshing their balances.
    db.flush()
    return {user.id:user for user in db.scalars(select(models.User)
        .where(models.User.id.in_(sorted({identifier for identifier in identifiers if identifier})))
        .order_by(models.User.id).with_for_update().execution_options(populate_existing=True))}
