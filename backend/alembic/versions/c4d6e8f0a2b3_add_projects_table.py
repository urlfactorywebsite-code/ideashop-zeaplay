"""add projects table

Revision ID: c4d6e8f0a2b3
Revises: b3d5f7a9c1e2
Create Date: 2026-10-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "c4d6e8f0a2b3"
down_revision = "b3d5f7a9c1e2"
branch_labels = None
depends_on = None


def _uuid_type():
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(length=36), "sqlite")


def upgrade() -> None:
    project_status_enum = sa.Enum("ACTIVE", "ARCHIVED", name="project_status_enum")
    project_member_role_enum = sa.Enum("MANAGER", "MEMBER", name="project_member_role_enum")

    op.create_unique_constraint("uq_users_id_tenant", "users", ["id", "tenant_id"])
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", project_status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("start_date", sa.DateTime(), nullable=True),
        sa.Column("end_date", sa.DateTime(), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_id", sa.String(length=36), nullable=True),
        sa.Column("archived_by_id", sa.String(length=36), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["client_id", "tenant_id"], ["clients.id", "clients.tenant_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["archived_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "tenant_id", name="uq_projects_id_tenant"),
    )
    op.create_index("ix_projects_tenant_id", "projects", ["tenant_id"])
    op.create_index("ix_projects_tenant_status_updated", "projects", ["tenant_id", "status", "updated_at"])
    op.create_index("ix_projects_tenant_client", "projects", ["tenant_id", "client_id"])
    op.create_index("ix_projects_tenant_name", "projects", ["tenant_id", "normalized_name"])
    op.create_index("ix_projects_tenant_created", "projects", ["tenant_id", "created_at"])

    op.create_table(
        "project_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", _uuid_type(), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", project_member_role_enum, nullable=False),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("updated_by_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id", "tenant_id"], ["users.id", "users.tenant_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "project_id", "user_id", name="uq_project_members_tenant_project_user"),
    )
    op.create_index("ix_project_members_tenant_id", "project_members", ["tenant_id"])
    op.create_index("ix_project_members_tenant_project", "project_members", ["tenant_id", "project_id"])
    op.create_index("ix_project_members_tenant_user", "project_members", ["tenant_id", "user_id"])
    op.create_index("ix_project_members_tenant_role", "project_members", ["tenant_id", "role"])


def downgrade() -> None:
    op.drop_index("ix_project_members_tenant_role", table_name="project_members")
    op.drop_index("ix_project_members_tenant_user", table_name="project_members")
    op.drop_index("ix_project_members_tenant_project", table_name="project_members")
    op.drop_index("ix_project_members_tenant_id", table_name="project_members")
    op.drop_table("project_members")
    op.drop_index("ix_projects_tenant_created", table_name="projects")
    op.drop_index("ix_projects_tenant_name", table_name="projects")
    op.drop_index("ix_projects_tenant_client", table_name="projects")
    op.drop_index("ix_projects_tenant_status_updated", table_name="projects")
    op.drop_index("ix_projects_tenant_id", table_name="projects")
    op.drop_table("projects")
    op.drop_constraint("uq_users_id_tenant", "users", type_="unique")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="project_member_role_enum").drop(bind, checkfirst=True)
        sa.Enum(name="project_status_enum").drop(bind, checkfirst=True)
