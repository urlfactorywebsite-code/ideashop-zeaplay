"""Track physical chat uploads, including unsent drafts, for per-user quotas."""
import sqlalchemy as sa
from alembic import op

revision = "fff5c6d7e8f9"
down_revision = "ffe4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    # Bootstrap-enabled installations may already have created this table.
    if "chat_uploads" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "chat_uploads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("original_file_name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1024), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("storage_key", name="uq_chat_uploads_storage_key"),
        sa.CheckConstraint("file_size >= 0", name="ck_chat_uploads_file_size"),
    )
    op.create_index("ix_chat_uploads_owner", "chat_uploads", ["tenant_id", "user_id"])


def downgrade():
    raise RuntimeError("Chat upload ownership is required for quotas; restore a reviewed backup to roll back.")
