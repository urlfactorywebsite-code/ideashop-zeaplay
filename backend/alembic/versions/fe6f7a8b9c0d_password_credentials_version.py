"""Invalidate HTTP credentials after password changes without changing balances.

Revision ID: fe6f7a8b9c0d
Revises: fd5e6f7a8b9c
"""
from alembic import op
import sqlalchemy as sa

revision = "fe6f7a8b9c0d"
down_revision = "fd5e6f7a8b9c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("credentials_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    if op.get_context().as_sql:
        raise RuntimeError("Credential downgrade requires an online revocation check")
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        connection.exec_driver_sql("LOCK TABLE users IN ACCESS EXCLUSIVE MODE")
    elif not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    if connection.scalar(sa.text("SELECT 1 FROM users WHERE credentials_version <> 0 LIMIT 1")):
        raise RuntimeError("Credential revocations exist: retain column and use a compatible forward fix")
    op.drop_column("users", "credentials_version")
