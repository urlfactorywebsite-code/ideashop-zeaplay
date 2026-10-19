"""Add enum labels omitted by legacy metadata-bootstrap installations."""
from sqlalchemy import literal, text

from .. import models


def notification_enum_gaps(connection):
    if connection.dialect.name != "postgresql":
        return {}
    missing = {}
    for column in (models.Notification.__table__.c.type, models.Notification.__table__.c.entity_type):
        enum = column.type
        existing = connection.scalars(text("SELECT enumlabel FROM pg_enum WHERE enumtypid=to_regtype(:name)"),
                                      {"name": enum.name}).all()
        if existing:
            values = [value for value in enum.enums if value not in existing]
            if values:
                missing[enum.name] = values
    return missing


def ensure_notification_enum_values(connection):
    """Caller commits before using new labels; never delete/rename existing values."""
    if connection.dialect.name != "postgresql":
        return {}
    connection.execute(text("SELECT pg_advisory_xact_lock(741906242)"))
    missing = notification_enum_gaps(connection)
    quote = connection.dialect.identifier_preparer.quote
    for name, values in missing.items():
        schema = connection.scalar(text("SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace "
                                        "WHERE t.oid=to_regtype(:name)"), {"name": name})
        for value in values:
            label = literal(value).compile(dialect=connection.dialect, compile_kwargs={"literal_binds": True})
            connection.exec_driver_sql(f"ALTER TYPE {quote(schema)}.{quote(name)} ADD VALUE IF NOT EXISTS {label}")
    return missing
