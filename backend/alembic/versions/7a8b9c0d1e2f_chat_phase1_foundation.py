"""chat phase 1 foundation

Revision ID: 7a8b9c0d1e2f
Revises: 6e7f8g9h0i1j
Create Date: 2026-09-04 10:00:00.000000
"""

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "7a8b9c0d1e2f"
down_revision = "6e7f8g9h0i1j"
branch_labels = None
depends_on = None


chat_conversation_type = postgresql.ENUM("SPACE", "DIRECT", "GROUP", name="chatconversationtypeenum", create_type=False)
chat_member_role = postgresql.ENUM("OWNER", "ADMIN", "MEMBER", name="chatmemberroleenum", create_type=False)
chat_message_type = postgresql.ENUM("TEXT", "IMAGE", "FILE", "SYSTEM", name="chatmessagetypeenum", create_type=False)


class _OfflineInspector:
    def __init__(self, tables: dict[str, dict[str, set[str]]] | None = None) -> None:
        self.tables = tables or {}

    def get_table_names(self) -> list[str]:
        return list(self.tables)

    def get_columns(self, table_name: str) -> list[dict[str, str]]:
        return [{"name": name} for name in self.tables.get(table_name, {}).get("columns", set())]

    def get_indexes(self, table_name: str) -> list[dict[str, str]]:
        return [{"name": name} for name in self.tables.get(table_name, {}).get("indexes", set())]

    def get_unique_constraints(self, table_name: str) -> list[dict[str, str]]:
        return [{"name": name} for name in self.tables.get(table_name, {}).get("unique_constraints", set())]


def _created_chat_schema_inspector() -> _OfflineInspector:
    return _OfflineInspector(
        {
            "chat_conversations": {
                "columns": {
                    "id",
                    "tenant_id",
                    "name",
                    "description",
                    "avatar_url",
                    "type",
                    "project_id",
                    "team_id",
                    "direct_key",
                    "is_private",
                    "is_archived",
                    "created_by_id",
                    "created_at",
                    "updated_at",
                    "last_message_at",
                },
                "indexes": set(),
                "unique_constraints": {"uq_chat_conversation_direct_key"},
            },
            "chat_participants": {
                "columns": {
                    "id",
                    "conversation_id",
                    "user_id",
                    "role",
                    "is_admin",
                    "joined_at",
                    "last_read_message_id",
                    "last_read_at",
                    "is_muted",
                    "is_pinned",
                },
                "indexes": set(),
                "unique_constraints": {"uq_chat_participant"},
            },
            "chat_messages": {
                "columns": {
                    "id",
                    "conversation_id",
                    "sender_id",
                    "message_type",
                    "client_id",
                    "content",
                    "reply_to_message_id",
                    "edited_at",
                    "deleted_at",
                    "created_at",
                    "updated_at",
                },
                "indexes": set(),
                "unique_constraints": set(),
            },
        }
    )


def _has_table(inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_unique_constraint(inspector, table_name: str, constraint_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_unique_constraints(table_name)
    }


def upgrade() -> None:
    bind = op.get_bind()
    offline = context.is_offline_mode()
    inspector = _OfflineInspector() if offline else sa.inspect(bind)
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres and offline:
        op.execute("CREATE TYPE chatconversationtypeenum AS ENUM ('SPACE', 'DIRECT', 'GROUP')")
        op.execute("CREATE TYPE chatmemberroleenum AS ENUM ('OWNER', 'ADMIN', 'MEMBER')")
        op.execute("CREATE TYPE chatmessagetypeenum AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM')")
    elif is_postgres:
        chat_conversation_type.create(bind, checkfirst=True)
        chat_member_role.create(bind, checkfirst=True)
        chat_message_type.create(bind, checkfirst=True)
        op.execute("ALTER TYPE chatconversationtypeenum ADD VALUE IF NOT EXISTS 'GROUP'")

    conversation_type = chat_conversation_type if is_postgres else sa.String(length=32)
    member_role_type = chat_member_role if is_postgres else sa.String(length=32)
    message_type = chat_message_type if is_postgres else sa.String(length=32)
    tenant_type = postgresql.UUID(as_uuid=True) if is_postgres else sa.String(length=36)

    if not _has_table(inspector, "chat_conversations"):
        op.create_table(
            "chat_conversations",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("tenant_id", tenant_type, nullable=False),
            sa.Column("name", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("avatar_url", sa.String(length=1024), nullable=True),
            sa.Column("type", conversation_type, nullable=False),
            sa.Column("project_id", sa.String(length=36), nullable=True),
            sa.Column("team_id", sa.String(length=255), nullable=True),
            sa.Column("direct_key", sa.String(length=255), nullable=True),
            sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_message_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "direct_key", name="uq_chat_conversation_direct_key"),
        )

    if not _has_table(inspector, "chat_participants"):
        op.create_table(
            "chat_participants",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("role", member_role_type, nullable=False, server_default="MEMBER"),
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("joined_at", sa.DateTime(), nullable=False),
            sa.Column("last_read_message_id", sa.String(length=36), nullable=True),
            sa.Column("last_read_at", sa.DateTime(), nullable=False),
            sa.Column("is_muted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_participant"),
        )

    if not _has_table(inspector, "chat_messages"):
        op.create_table(
            "chat_messages",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("sender_id", sa.String(length=36), nullable=False),
            sa.Column("message_type", message_type, nullable=False, server_default="TEXT"),
            sa.Column("client_id", sa.String(length=128), nullable=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("reply_to_message_id", sa.String(length=36), nullable=True),
            sa.Column("edited_at", sa.DateTime(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["reply_to_message_id"], ["chat_messages.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = _created_chat_schema_inspector() if offline else sa.inspect(bind)

    if not _has_column(inspector, "chat_conversations", "tenant_id"):
        op.add_column("chat_conversations", sa.Column("tenant_id", tenant_type, nullable=True))
        op.execute(
            """
            UPDATE chat_conversations
            SET tenant_id = COALESCE(
                (SELECT users.tenant_id FROM users WHERE users.id = chat_conversations.created_by_id),
                (SELECT users.tenant_id FROM users LIMIT 1)
            )
            WHERE tenant_id IS NULL
            """
        )
        if is_postgres:
            op.alter_column("chat_conversations", "tenant_id", nullable=False)
        else:
            with op.batch_alter_table("chat_conversations") as batch:
                batch.alter_column("tenant_id", existing_type=tenant_type, nullable=False)
    if not _has_column(inspector, "chat_conversations", "avatar_url"):
        op.add_column("chat_conversations", sa.Column("avatar_url", sa.String(length=1024), nullable=True))
    if not _has_column(inspector, "chat_conversations", "project_id"):
        op.add_column("chat_conversations", sa.Column("project_id", sa.String(length=36), nullable=True))
    if not _has_column(inspector, "chat_conversations", "team_id"):
        op.add_column("chat_conversations", sa.Column("team_id", sa.String(length=255), nullable=True))
    if not _has_column(inspector, "chat_conversations", "direct_key"):
        op.add_column("chat_conversations", sa.Column("direct_key", sa.String(length=255), nullable=True))
    if not _has_column(inspector, "chat_conversations", "is_archived"):
        op.add_column("chat_conversations", sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()))

    if not _has_column(inspector, "chat_participants", "id"):
        op.add_column("chat_participants", sa.Column("id", sa.String(length=36), nullable=True))
        if is_postgres:
            op.execute("UPDATE chat_participants SET id = gen_random_uuid()::text WHERE id IS NULL")
        else:
            op.execute("UPDATE chat_participants SET id = conversation_id || ':' || user_id WHERE id IS NULL")
        if is_postgres:
            op.alter_column("chat_participants", "id", nullable=False)
            op.create_unique_constraint("uq_chat_participants_id", "chat_participants", ["id"])
        else:
            with op.batch_alter_table("chat_participants") as batch:
                batch.alter_column("id", existing_type=sa.String(length=36), nullable=False)
                batch.create_unique_constraint("uq_chat_participants_id", ["id"])
    if not _has_column(inspector, "chat_participants", "role"):
        op.add_column("chat_participants", sa.Column("role", member_role_type, nullable=False, server_default="MEMBER"))
        op.execute("UPDATE chat_participants SET role = 'ADMIN' WHERE is_admin = true")
    if not _has_column(inspector, "chat_participants", "last_read_message_id"):
        op.add_column("chat_participants", sa.Column("last_read_message_id", sa.String(length=36), nullable=True))
    if not _has_column(inspector, "chat_participants", "is_muted"):
        op.add_column("chat_participants", sa.Column("is_muted", sa.Boolean(), nullable=False, server_default=sa.false()))
    if not _has_column(inspector, "chat_participants", "is_pinned"):
        op.add_column("chat_participants", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()))

    if not _has_column(inspector, "chat_messages", "message_type"):
        op.add_column("chat_messages", sa.Column("message_type", message_type, nullable=False, server_default="TEXT"))
    if not _has_column(inspector, "chat_messages", "client_id"):
        op.add_column("chat_messages", sa.Column("client_id", sa.String(length=128), nullable=True))
    if not _has_column(inspector, "chat_messages", "reply_to_message_id"):
        op.add_column("chat_messages", sa.Column("reply_to_message_id", sa.String(length=36), nullable=True))
        if is_postgres:
            op.create_foreign_key("fk_chat_messages_reply_to", "chat_messages", "chat_messages", ["reply_to_message_id"], ["id"], ondelete="SET NULL")
        else:
            with op.batch_alter_table("chat_messages") as batch:
                batch.create_foreign_key("fk_chat_messages_reply_to", "chat_messages", ["reply_to_message_id"], ["id"], ondelete="SET NULL")
    if not _has_column(inspector, "chat_messages", "edited_at"):
        op.add_column("chat_messages", sa.Column("edited_at", sa.DateTime(), nullable=True))
    if not _has_column(inspector, "chat_messages", "deleted_at"):
        op.add_column("chat_messages", sa.Column("deleted_at", sa.DateTime(), nullable=True))

    inspector = _created_chat_schema_inspector() if offline else sa.inspect(bind)

    op.create_index("ix_chat_conversations_tenant_updated", "chat_conversations", ["tenant_id", "updated_at"], if_not_exists=True)
    op.create_index("ix_chat_conversations_tenant_last_message", "chat_conversations", ["tenant_id", "last_message_at"], if_not_exists=True)
    op.create_index("ix_chat_conversations_type", "chat_conversations", ["type"], if_not_exists=True)
    op.create_index("ix_chat_conversations_team_id", "chat_conversations", ["team_id"], if_not_exists=True)
    op.create_index("ix_chat_conversations_project_id", "chat_conversations", ["project_id"], if_not_exists=True)
    op.create_index("ix_chat_conversations_direct_key", "chat_conversations", ["tenant_id", "direct_key"], if_not_exists=True)
    if not _has_unique_constraint(inspector, "chat_conversations", "uq_chat_conversation_direct_key") and not _has_index(
        inspector,
        "chat_conversations",
        "uq_chat_conversation_direct_key",
    ):
        if is_postgres:
            op.create_unique_constraint(
                "uq_chat_conversation_direct_key",
                "chat_conversations",
                ["tenant_id", "direct_key"],
            )
        else:
            with op.batch_alter_table("chat_conversations") as batch:
                batch.create_unique_constraint("uq_chat_conversation_direct_key", ["tenant_id", "direct_key"])
    op.create_index("ix_chat_participants_user_id", "chat_participants", ["user_id"], if_not_exists=True)
    op.create_index("ix_chat_participants_conversation_id", "chat_participants", ["conversation_id"], if_not_exists=True)
    op.create_index("ix_chat_participants_user_conversation", "chat_participants", ["user_id", "conversation_id"], if_not_exists=True)
    op.create_index("ix_chat_messages_conversation_created", "chat_messages", ["conversation_id", "created_at"], if_not_exists=True)
    op.create_index("ix_chat_messages_conversation_created_id", "chat_messages", ["conversation_id", "created_at", "id"], if_not_exists=True)
    op.create_index("ix_chat_messages_client_id", "chat_messages", ["conversation_id", "sender_id", "client_id"], if_not_exists=True)
    if not _has_unique_constraint(inspector, "chat_messages", "uq_chat_message_client_id") and not _has_index(
        inspector,
        "chat_messages",
        "uq_chat_message_client_id",
    ):
        if is_postgres:
            op.create_unique_constraint(
                "uq_chat_message_client_id",
                "chat_messages",
                ["conversation_id", "sender_id", "client_id"],
            )
        else:
            with op.batch_alter_table("chat_messages") as batch:
                batch.create_unique_constraint("uq_chat_message_client_id", ["conversation_id", "sender_id", "client_id"])
    op.create_index("ix_chat_messages_content", "chat_messages", ["content"], if_not_exists=True)
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"], if_not_exists=True)
    op.create_index("ix_chat_messages_reply_to", "chat_messages", ["reply_to_message_id"], if_not_exists=True)

    op.create_table(
        "message_reactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("emoji", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),
        if_not_exists=True,
    )
    op.create_index("ix_message_reactions_message_id", "message_reactions", ["message_id"], if_not_exists=True)

    op.create_table(
        "message_attachments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("original_file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index("ix_message_attachments_message_id", "message_attachments", ["message_id"], if_not_exists=True)

    op.create_table(
        "pinned_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("pinned_by", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pinned_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "message_id", name="uq_pinned_message"),
        if_not_exists=True,
    )
    op.create_index("ix_pinned_messages_conversation_id", "pinned_messages", ["conversation_id"], if_not_exists=True)

    op.create_table(
        "message_mentions",
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("mentioned_user_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["mentioned_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "mentioned_user_id"),
        sa.UniqueConstraint("message_id", "mentioned_user_id", name="uq_message_mention"),
        if_not_exists=True,
    )
    op.create_index("ix_message_mentions_mentioned_user_id", "message_mentions", ["mentioned_user_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_chat_messages_reply_to", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_messages_sender_id", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_messages_content", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_messages_client_id", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_messages_conversation_created_id", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_messages_conversation_created", table_name="chat_messages", if_exists=True)
    op.drop_index("ix_chat_participants_user_conversation", table_name="chat_participants", if_exists=True)
    op.drop_index("ix_chat_participants_conversation_id", table_name="chat_participants", if_exists=True)
    op.drop_index("ix_chat_participants_user_id", table_name="chat_participants", if_exists=True)
    op.drop_index("ix_chat_conversations_project_id", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_chat_conversations_direct_key", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_chat_conversations_team_id", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_chat_conversations_type", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_chat_conversations_tenant_last_message", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_chat_conversations_tenant_updated", table_name="chat_conversations", if_exists=True)
    op.drop_index("ix_message_mentions_mentioned_user_id", table_name="message_mentions", if_exists=True)
    op.drop_table("message_mentions", if_exists=True)
    op.drop_index("ix_pinned_messages_conversation_id", table_name="pinned_messages", if_exists=True)
    op.drop_table("pinned_messages", if_exists=True)
    op.drop_index("ix_message_attachments_message_id", table_name="message_attachments", if_exists=True)
    op.drop_table("message_attachments", if_exists=True)
    op.drop_index("ix_message_reactions_message_id", table_name="message_reactions", if_exists=True)
    op.drop_table("message_reactions", if_exists=True)
    op.drop_table("chat_messages", if_exists=True)
    op.drop_table("chat_participants", if_exists=True)
    op.drop_table("chat_conversations", if_exists=True)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        chat_message_type.drop(bind, checkfirst=True)
        chat_member_role.drop(bind, checkfirst=True)
        chat_conversation_type.drop(bind, checkfirst=True)
