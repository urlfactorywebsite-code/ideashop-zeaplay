from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from ..config import get_settings
from ..database import engine

logger = logging.getLogger(__name__)


def _has_table(inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _columns(inspector, table_name: str) -> set[str]:
    if not _has_table(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(inspector, table_name: str) -> set[str]:
    if not _has_table(inspector, table_name):
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _unique_constraints(inspector, table_name: str) -> set[str]:
    if not _has_table(inspector, table_name):
        return set()
    return {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}


def ensure_chat_schema() -> None:
    """Bring legacy Chat tables up to the schema expected by the current app.

    Alembic is still the source of truth for fresh installs. This guard exists for
    long-lived deployments whose alembic_version drifted while old chat tables
    already existed.
    """
    inspector = inspect(engine)
    if not _has_table(inspector, "chat_conversations"):
        return

    is_postgres = engine.dialect.name == "postgresql"
    default_tenant_id = get_settings().default_tenant_id

    conversation_columns = _columns(inspector, "chat_conversations")
    participant_columns = _columns(inspector, "chat_participants")
    message_columns = _columns(inspector, "chat_messages")
    conversation_indexes = _indexes(inspector, "chat_conversations")
    participant_indexes = _indexes(inspector, "chat_participants")
    message_indexes = _indexes(inspector, "chat_messages")
    conversation_uniques = _unique_constraints(inspector, "chat_conversations")
    message_uniques = _unique_constraints(inspector, "chat_messages")

    statements: list[str] = []

    if is_postgres:
        statements.extend(
            [
                "DO $$ BEGIN CREATE TYPE chatconversationtypeenum AS ENUM ('SPACE', 'DIRECT', 'GROUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
                "DO $$ BEGIN CREATE TYPE chatmemberroleenum AS ENUM ('OWNER', 'ADMIN', 'MEMBER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
                "DO $$ BEGIN CREATE TYPE chatmessagetypeenum AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
                "ALTER TYPE chatconversationtypeenum ADD VALUE IF NOT EXISTS 'GROUP'",
            ]
        )

    def add_column(table: str, column: str, pg_definition: str, sqlite_definition: str | None = None) -> None:
        columns = {
            "chat_conversations": conversation_columns,
            "chat_participants": participant_columns,
            "chat_messages": message_columns,
        }[table]
        if column in columns:
            return
        definition = pg_definition if is_postgres or sqlite_definition is None else sqlite_definition
        if is_postgres:
            statements.append(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}")
        else:
            statements.append(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    add_column("chat_conversations", "tenant_id", "UUID", "VARCHAR(36)")
    add_column("chat_conversations", "avatar_url", "VARCHAR(1024)")
    add_column("chat_conversations", "project_id", "VARCHAR(36)")
    add_column("chat_conversations", "team_id", "VARCHAR(255)")
    add_column("chat_conversations", "direct_key", "VARCHAR(255)")
    add_column("chat_conversations", "is_archived", "BOOLEAN NOT NULL DEFAULT false", "BOOLEAN NOT NULL DEFAULT 0")

    add_column("chat_participants", "id", "VARCHAR(36)", "VARCHAR(36)")
    add_column("chat_participants", "role", "VARCHAR(32) NOT NULL DEFAULT 'MEMBER'")
    add_column("chat_participants", "last_read_message_id", "VARCHAR(36)")
    add_column("chat_participants", "is_muted", "BOOLEAN NOT NULL DEFAULT false", "BOOLEAN NOT NULL DEFAULT 0")
    add_column("chat_participants", "is_pinned", "BOOLEAN NOT NULL DEFAULT false", "BOOLEAN NOT NULL DEFAULT 0")

    add_column("chat_messages", "message_type", "VARCHAR(32) NOT NULL DEFAULT 'TEXT'")
    add_column("chat_messages", "client_id", "VARCHAR(128)")
    add_column("chat_messages", "reply_to_message_id", "VARCHAR(36)")
    add_column("chat_messages", "edited_at", "TIMESTAMP")
    add_column("chat_messages", "deleted_at", "TIMESTAMP")

    if "tenant_id" not in conversation_columns:
        if is_postgres:
            statements.append(
                f"""
                UPDATE chat_conversations AS conversation
                SET tenant_id = COALESCE(
                    (SELECT users.tenant_id FROM users WHERE users.id = conversation.created_by_id),
                    (
                        SELECT users.tenant_id
                        FROM chat_participants AS participant
                        JOIN users ON users.id = participant.user_id
                        WHERE participant.conversation_id = conversation.id
                        LIMIT 1
                    ),
                    '{default_tenant_id}'::uuid
                )
                WHERE tenant_id IS NULL
                """
            )
            statements.append("ALTER TABLE chat_conversations ALTER COLUMN tenant_id SET NOT NULL")
        else:
            statements.append(
                f"""
                UPDATE chat_conversations
                SET tenant_id = COALESCE(
                    (SELECT users.tenant_id FROM users WHERE users.id = chat_conversations.created_by_id),
                    (
                        SELECT users.tenant_id
                        FROM chat_participants AS participant
                        JOIN users ON users.id = participant.user_id
                        WHERE participant.conversation_id = chat_conversations.id
                        LIMIT 1
                    ),
                    '{default_tenant_id}'
                )
                WHERE tenant_id IS NULL
                """
            )

    if "id" not in participant_columns:
        if is_postgres:
            statements.append(
                "UPDATE chat_participants SET id = md5(conversation_id || ':' || user_id) WHERE id IS NULL OR id = ''"
            )
        else:
            statements.append(
                "UPDATE chat_participants SET id = substr(conversation_id || ':' || user_id, 1, 36) WHERE id IS NULL OR id = ''"
            )
        if is_postgres:
            statements.append("ALTER TABLE chat_participants ALTER COLUMN id SET NOT NULL")

    if "role" not in participant_columns:
        statements.append("UPDATE chat_participants SET role = 'ADMIN' WHERE is_admin = true")
        statements.append("UPDATE chat_participants SET role = 'MEMBER' WHERE role IS NULL OR role = ''")

    index_statements = {
        "ix_chat_conversations_tenant_updated": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_tenant_updated ON chat_conversations (tenant_id, updated_at)",
        "ix_chat_conversations_tenant_last_message": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_tenant_last_message ON chat_conversations (tenant_id, last_message_at)",
        "ix_chat_conversations_type": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_type ON chat_conversations (type)",
        "ix_chat_conversations_team_id": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_team_id ON chat_conversations (team_id)",
        "ix_chat_conversations_project_id": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_project_id ON chat_conversations (project_id)",
        "ix_chat_conversations_direct_key": "CREATE INDEX IF NOT EXISTS ix_chat_conversations_direct_key ON chat_conversations (tenant_id, direct_key)",
        "ix_chat_participants_user_id": "CREATE INDEX IF NOT EXISTS ix_chat_participants_user_id ON chat_participants (user_id)",
        "ix_chat_participants_conversation_id": "CREATE INDEX IF NOT EXISTS ix_chat_participants_conversation_id ON chat_participants (conversation_id)",
        "ix_chat_participants_user_conversation": "CREATE INDEX IF NOT EXISTS ix_chat_participants_user_conversation ON chat_participants (user_id, conversation_id)",
        "ix_chat_messages_conversation_created": "CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_created ON chat_messages (conversation_id, created_at)",
        "ix_chat_messages_conversation_created_id": "CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_created_id ON chat_messages (conversation_id, created_at, id)",
        "ix_chat_messages_client_id": "CREATE INDEX IF NOT EXISTS ix_chat_messages_client_id ON chat_messages (conversation_id, sender_id, client_id)",
        "ix_chat_messages_content": "CREATE INDEX IF NOT EXISTS ix_chat_messages_content ON chat_messages (content)",
        "ix_chat_messages_sender_id": "CREATE INDEX IF NOT EXISTS ix_chat_messages_sender_id ON chat_messages (sender_id)",
        "ix_chat_messages_reply_to": "CREATE INDEX IF NOT EXISTS ix_chat_messages_reply_to ON chat_messages (reply_to_message_id)",
    }
    existing_indexes = conversation_indexes | participant_indexes | message_indexes
    statements.extend(sql for name, sql in index_statements.items() if name not in existing_indexes)

    if "uq_chat_conversation_direct_key" not in conversation_uniques and "uq_chat_conversation_direct_key" not in conversation_indexes:
        if is_postgres:
            statements.append(
                "ALTER TABLE chat_conversations ADD CONSTRAINT uq_chat_conversation_direct_key UNIQUE (tenant_id, direct_key)"
            )
        else:
            statements.append(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversation_direct_key ON chat_conversations (tenant_id, direct_key)"
            )
    if "uq_chat_message_client_id" not in message_uniques and "uq_chat_message_client_id" not in message_indexes:
        if is_postgres:
            statements.append(
                "ALTER TABLE chat_messages ADD CONSTRAINT uq_chat_message_client_id UNIQUE (conversation_id, sender_id, client_id)"
            )
        else:
            statements.append(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_message_client_id ON chat_messages (conversation_id, sender_id, client_id)"
            )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
    logger.info("chat.schema.repaired statements=%s", len(statements))
