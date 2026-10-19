"""Transaction-local, authenticated audit attribution; never infer a system actor."""
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import Pool


@event.listens_for(Engine, "connect")
def _sqlite_functions(connection, record):
    if type(connection).__module__.startswith("sqlite3"):
        context = {"actor_id": None}
        record.info["lifecycle_context"] = context
        connection.create_function("zea_lifecycle_actor", 0, lambda: context["actor_id"])


@event.listens_for(Pool, "checkin")
def _clear_connection_context(connection, record):
    if "lifecycle_context" in record.info:
        record.info["lifecycle_context"]["actor_id"] = None


@event.listens_for(Pool, "checkout")
def _existing_sqlite_connection(connection, record, proxy):
    if "lifecycle_context" not in record.info:
        _sqlite_functions(connection, record)


def _set(connection, actor_id):
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT set_config('zea.lifecycle_actor', :actor, true)"), {"actor": actor_id or ""})
    elif connection.dialect.name == "sqlite":
        connection.info["lifecycle_context"]["actor_id"] = actor_id


@event.listens_for(Session, "after_begin")
def _transaction_actor(session, transaction, connection):
    actor_id = session.info.get("lifecycle_actor_id")
    if actor_id or connection.dialect.name == "sqlite":
        _set(connection, actor_id)
    session.info.pop("lifecycle_actor_dirty", None)


@event.listens_for(Session, "after_soft_rollback")
def _restore_savepoint_actor(session, previous_transaction):
    # PostgreSQL rolls SET LOCAL back with a savepoint; Session.info is not rolled back.
    # Defer SQL until the failed context manager has exited.
    if previous_transaction.nested:
        session.info["lifecycle_actor_dirty"] = True


def _apply_pending_actor(session):
    if session.info.pop("lifecycle_actor_dirty", False):
        _set(session.connection(), session.info.get("lifecycle_actor_id"))


@event.listens_for(Session, "do_orm_execute")
def _before_statement(state):
    _apply_pending_actor(state.session)


@event.listens_for(Session, "before_flush")
def _before_flush(session, flush_context, instances):
    _apply_pending_actor(session)


def bind_actor(db: Session, actor) -> None:
    if db.info.get("lifecycle_actor_id") == str(actor.id) and not db.info.get("lifecycle_actor_dirty"):
        return
    db.info["lifecycle_actor_id"] = str(actor.id)
    _set(db.connection(), str(actor.id))
    db.info.pop("lifecycle_actor_dirty", None)
