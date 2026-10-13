"""add clients table

Revision ID: a2c4e6f8g0h1
Revises: 9c8d7e6f5a4b
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "a2c4e6f8g0h1"
down_revision = "9c8d7e6f5a4b"
branch_labels = None
depends_on = None


def _uuid_type():
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(length=36), "sqlite")


def upgrade() -> None:
    status_enum = sa.Enum("ACTIVE", "ARCHIVED", name="client_status_enum")
    op.create_table(
        "clients",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=False),
        sa.Column("normalized_company_name", sa.String(length=255), nullable=False),
        sa.Column("gst_number", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=120), nullable=True),
        sa.Column("postal_code", sa.String(length=32), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_id", sa.String(length=36), nullable=True),
        sa.Column("archived_by_id", sa.String(length=36), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["archived_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clients_tenant_id", "clients", ["tenant_id"])
    op.create_index("ix_clients_tenant_status_updated", "clients", ["tenant_id", "status", "updated_at"])
    op.create_index("ix_clients_tenant_normalized_name", "clients", ["tenant_id", "normalized_company_name"])
    op.create_index("ix_clients_tenant_gst", "clients", ["tenant_id", "gst_number"])
    op.create_index("ix_clients_tenant_created", "clients", ["tenant_id", "created_at"])
    op.create_index(
        "uq_clients_active_tenant_normalized_name",
        "clients",
        ["tenant_id", "normalized_company_name"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
        sqlite_where=sa.text("status = 'ACTIVE'"),
    )
    op.create_index(
        "uq_clients_active_tenant_gst",
        "clients",
        ["tenant_id", "gst_number"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND gst_number IS NOT NULL"),
        sqlite_where=sa.text("status = 'ACTIVE' AND gst_number IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_clients_active_tenant_gst", table_name="clients")
    op.drop_index("uq_clients_active_tenant_normalized_name", table_name="clients")
    op.drop_index("ix_clients_tenant_created", table_name="clients")
    op.drop_index("ix_clients_tenant_gst", table_name="clients")
    op.drop_index("ix_clients_tenant_normalized_name", table_name="clients")
    op.drop_index("ix_clients_tenant_status_updated", table_name="clients")
    op.drop_index("ix_clients_tenant_id", table_name="clients")
    op.drop_table("clients")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="client_status_enum").drop(bind, checkfirst=True)
