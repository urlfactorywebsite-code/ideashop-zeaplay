"""add contacts table

Revision ID: b3d5f7a9c1e2
Revises: a2c4e6f8g0h1
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b3d5f7a9c1e2"
down_revision = "a2c4e6f8g0h1"
branch_labels = None
depends_on = None


def _uuid_type():
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(length=36), "sqlite")


def upgrade() -> None:
    status_enum = sa.Enum("ACTIVE", "ARCHIVED", name="contact_status_enum")
    op.create_unique_constraint("uq_clients_id_tenant", "clients", ["id", "tenant_id"])
    op.create_table(
        "contacts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("first_name", sa.String(length=120), nullable=False),
        sa.Column("last_name", sa.String(length=120), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("normalized_email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("normalized_phone", sa.String(length=32), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=True),
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
        sa.UniqueConstraint("id", "tenant_id", name="uq_contacts_id_tenant"),
    )
    op.create_index("ix_contacts_tenant_id", "contacts", ["tenant_id"])
    op.create_index("ix_contacts_tenant_status_updated", "contacts", ["tenant_id", "status", "updated_at"])
    op.create_index("ix_contacts_tenant_display_name", "contacts", ["tenant_id", "display_name"])
    op.create_index("ix_contacts_tenant_email", "contacts", ["tenant_id", "normalized_email"])
    op.create_index("ix_contacts_tenant_phone", "contacts", ["tenant_id", "normalized_phone"])
    op.create_index(
        "uq_contacts_active_tenant_email",
        "contacts",
        ["tenant_id", "normalized_email"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND normalized_email IS NOT NULL"),
        sqlite_where=sa.text("status = 'ACTIVE' AND normalized_email IS NOT NULL"),
    )
    op.create_index(
        "uq_contacts_active_tenant_name_phone",
        "contacts",
        ["tenant_id", "normalized_name", "normalized_phone"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND normalized_phone IS NOT NULL"),
        sqlite_where=sa.text("status = 'ACTIVE' AND normalized_phone IS NOT NULL"),
    )
    op.create_table(
        "client_contacts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("contact_id", sa.String(length=36), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["client_id", "tenant_id"], ["clients.id", "clients.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id", "tenant_id"], ["contacts.id", "contacts.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "client_id", "contact_id", name="uq_client_contacts_tenant_client_contact"),
    )
    op.create_index("ix_client_contacts_tenant_id", "client_contacts", ["tenant_id"])
    op.create_index("ix_client_contacts_tenant_client", "client_contacts", ["tenant_id", "client_id"])
    op.create_index("ix_client_contacts_tenant_contact", "client_contacts", ["tenant_id", "contact_id"])
    op.create_index(
        "uq_client_contacts_primary_per_client",
        "client_contacts",
        ["tenant_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("is_primary = true"),
        sqlite_where=sa.text("is_primary = 1"),
    )


def downgrade() -> None:
    op.drop_index("uq_client_contacts_primary_per_client", table_name="client_contacts")
    op.drop_index("ix_client_contacts_tenant_contact", table_name="client_contacts")
    op.drop_index("ix_client_contacts_tenant_client", table_name="client_contacts")
    op.drop_index("ix_client_contacts_tenant_id", table_name="client_contacts")
    op.drop_table("client_contacts")
    op.drop_index("uq_contacts_active_tenant_name_phone", table_name="contacts")
    op.drop_index("uq_contacts_active_tenant_email", table_name="contacts")
    op.drop_index("ix_contacts_tenant_phone", table_name="contacts")
    op.drop_index("ix_contacts_tenant_email", table_name="contacts")
    op.drop_index("ix_contacts_tenant_display_name", table_name="contacts")
    op.drop_index("ix_contacts_tenant_status_updated", table_name="contacts")
    op.drop_index("ix_contacts_tenant_id", table_name="contacts")
    op.drop_table("contacts")
    op.drop_constraint("uq_clients_id_tenant", "clients", type_="unique")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="contact_status_enum").drop(bind, checkfirst=True)
