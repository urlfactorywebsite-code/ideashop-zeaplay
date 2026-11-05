"""Tenant-scoped task status configuration; preserve every existing task enum.

Revision ID: f006d7e8f9a0
Revises: fff5c6d7e8f9
"""
from datetime import datetime
from uuid import NAMESPACE_URL, uuid4, uuid5
import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "f006d7e8f9a0"
down_revision = "fff5c6d7e8f9"
branch_labels = None
depends_on = None

BLUEPRINT = (
    ("WAITING_FOR_REQUIREMENT", "BATTLE_PLAN", "Battle Plan"), ("TODO", "TODO", "Case Filed"),
    ("IN_PROGRESS", "IN_PROGRESS", "In Progress"), ("BUG_FIXING", "BUG_FIXING", "Bug Fixing"),
    ("BLOCKED", "BLOCKED", "Boss Encounter"), ("IN_REVIEW", "IN_REVIEW", "Tactical Shift"),
    ("ON_HOLD", "ON_HOLD", "On Hold"), ("DONE", "CONQUERED", "Conquered"),
    ("DEPLOYED", "DEPLOYED", "Deployed"), ("FAILED", "FAILED", "Fallen"), ("GRAVEYARD", "GRAVEYARD", "Graveyard"),
)


COLORS = {'WAITING_FOR_REQUIREMENT': '#7DD3FC', 'TODO': '#93C5FD', 'IN_PROGRESS': '#818CF8', 'BUG_FIXING': '#E11D48', 'BLOCKED': '#F472B6', 'IN_REVIEW': '#2DD4BF', 'ON_HOLD': '#F59E0B', 'DONE': '#22C55E', 'DEPLOYED': '#14B8A6', 'FAILED': '#F43F5E', 'GRAVEYARD': '#64748B'}


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def checked_label(value):
    value = " ".join(unicodedata.normalize("NFKC", value).split())
    if not value or len(value) > 80 or any(unicodedata.category(char).startswith("C") for char in value):
        raise RuntimeError("Legacy Kanban names need 1-80 visible characters; review labels before migration")
    return value


def preflight(legacy):
    by_id = {row["id"]: row for row in legacy}
    claims = [(value, name, checked_label(by_id[value]["title"]) if value in by_id else name, code, value)
              for value, code, name in BLUEPRINT]
    claims.extend((row["id"], checked_label(row["title"]), checked_label(row["title"]), None, None)
                  for row in legacy if row["id"] not in {item[0] for item in BLUEPRINT})
    used = {}
    for identifier, *values in claims:
        for value in values:
            if value is None:
                continue
            token = normalized(value)
            if token in used and used[token] != identifier:
                raise RuntimeError("Ambiguous legacy Kanban labels; review and resolve labels before retrying the migration")
            used[token] = identifier


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    tables = inspector.get_table_names()
    legacy = list(connection.execute(sa.text('SELECT id, title, "order" FROM kanban_columns')).mappings()) if "kanban_columns" in tables else []
    preflight(legacy)  # Validate all labels before any schema or data mutation.
    if "task_status_scopes" not in tables:
        op.create_table("task_status_scopes", sa.Column("tenant_id", sa.Uuid(), primary_key=True),
                        sa.Column("revision", sa.Integer(), nullable=False))
    if "task_statuses" not in tables:
        op.create_table("task_statuses",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("task_status_scopes.tenant_id"), nullable=False),
            sa.Column("code", sa.String(64), nullable=False), sa.Column("system_name", sa.String(80), nullable=False),
            sa.Column("normalized_name", sa.String(160), nullable=False),
            sa.Column("display_label", sa.String(80), nullable=False), sa.Column("normalized_label", sa.String(160), nullable=False),
            sa.Column("legacy_status", sa.String(40)), sa.Column("legacy_column_id", sa.String(36)), sa.Column("description", sa.String(500), nullable=False),
            sa.Column("color", sa.String(7), nullable=False), sa.Column("icon", sa.String(32), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False), sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("kanban_visible", sa.Boolean(), nullable=False), sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("tenant_id", "code", name="uq_task_status_code"),
            sa.UniqueConstraint("tenant_id", "normalized_name", name="uq_task_status_name"),
            sa.UniqueConstraint("tenant_id", "normalized_label", name="uq_task_status_label"),
            sa.UniqueConstraint("tenant_id", "legacy_column_id", name="uq_task_status_legacy_column"),
            sa.UniqueConstraint("tenant_id", "legacy_status", name="uq_task_status_legacy_status"),
            sa.CheckConstraint("is_system = (legacy_status IS NOT NULL)", name="ck_task_status_identity_kind"),
            sa.CheckConstraint("NOT is_system OR is_active", name="ck_task_status_system_active"))
        op.create_index("ix_task_statuses_tenant_id", "task_statuses", ["tenant_id"])
    if "legacy_column_id" not in {col["name"] for col in sa.inspect(connection).get_columns("task_statuses")}:
        op.add_column("task_statuses", sa.Column("legacy_column_id", sa.String(36)))
    existing_unique = {item["name"] for item in sa.inspect(connection).get_unique_constraints("task_statuses")} | {item["name"] for item in sa.inspect(connection).get_indexes("task_statuses")}
    for name, field in (("uq_task_status_legacy_column", "legacy_column_id"), ("uq_task_status_legacy_status", "legacy_status")):
        if name not in existing_unique:
            op.create_index(name, "task_statuses", ["tenant_id", field], unique=True)
    if "status_configuration_audits" not in tables:
        op.create_table("status_configuration_audits",
            sa.Column("id", sa.String(36), primary_key=True), sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("status_id", sa.String(36), nullable=False), sa.Column("actor_id", sa.String(36), nullable=False),
            sa.Column("action", sa.String(40), nullable=False), sa.Column("previous_values", sa.JSON(), nullable=False),
            sa.Column("new_values", sa.JSON(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
        op.create_index("ix_status_configuration_audits_tenant_id", "status_configuration_audits", ["tenant_id"])
    if "custom_status_id" not in {col["name"] for col in inspector.get_columns("tasks")}:
        # ADD COLUMN avoids rebuilding SQLite's existing lifecycle-triggered table.
        op.add_column("tasks", sa.Column("custom_status_id", sa.String(36), nullable=True))
        if connection.dialect.name == "postgresql":
            op.create_foreign_key("fk_tasks_custom_status", "tasks", "task_statuses", ["custom_status_id"], ["id"], ondelete="RESTRICT")
        op.create_index("ix_tasks_custom_status_id", "tasks", ["custom_status_id"])
    scopes = sa.Table("task_status_scopes", sa.MetaData(), sa.Column("tenant_id", sa.Uuid(), primary_key=True), autoload_with=connection)
    statuses = sa.Table("task_statuses", sa.MetaData(), sa.Column("tenant_id", sa.Uuid()), autoload_with=connection)
    users = sa.table("users", sa.column("tenant_id", sa.Uuid()))
    by_id = {row["id"]: row for row in legacy}
    for tenant in connection.execute(sa.select(users.c.tenant_id).distinct()).scalars():
        if tenant is None:
            continue
        if connection.execute(sa.select(scopes.c.tenant_id).where(scopes.c.tenant_id == tenant)).first() is None:
            connection.execute(scopes.insert().values(tenant_id=tenant, revision=0))
        if connection.execute(sa.select(statuses.c.id).where(statuses.c.tenant_id == tenant)).first():
            continue
        seeds = []
        for index, (value, code, name) in enumerate(BLUEPRINT):
            old = by_id.get(value)
            seeds.append((str(uuid5(NAMESPACE_URL, f"zeaplay:{tenant}:status:{code}")), value, code, name,
                          checked_label(old["title"]) if old else name, old["order"] if old else index, True))
        for old in legacy:
            if old["id"] not in {entry[0] for entry in BLUEPRINT}:
                seeds.append((str(uuid5(NAMESPACE_URL, f"zeaplay:{tenant}:column:{old['id']}")), None, "CUSTOM_" + uuid4().hex, checked_label(old["title"]), checked_label(old["title"]), old["order"], False))
        used = {}
        for identifier, value, code, name, label, order, system in seeds:
            for token in {normalized(name), normalized(label), normalized(code), normalized(value or code)}:
                if token in used and used[token] != identifier:
                    raise RuntimeError("Ambiguous legacy Kanban labels; review and resolve labels before retrying the migration")
                used[token] = identifier
            connection.execute(statuses.insert().values(id=identifier, tenant_id=tenant, code=code, system_name=name,
                normalized_name=normalized(name), display_label=label, normalized_label=normalized(label), legacy_status=value,
                legacy_column_id=next((old["id"] for old in legacy if checked_label(old["title"]) == name and not system), None),
                description="", color=COLORS.get(value, "#6366f1"), icon="default" if system else "circle", is_system=system, is_active=True, kanban_visible=True,
                sort_order=order, created_at=datetime.utcnow(), updated_at=datetime.utcnow()))
    # Versioned SQL guard module: keep this module compatible with this revision.
    try:
        from app.task_status_schema import install
    except ModuleNotFoundError:
        from backend.app.task_status_schema import install
    install(connection)


def downgrade():
    raise RuntimeError("Status configuration and audit history must be preserved. Roll back application code while retaining this additive schema, or restore a verified backup during maintenance.")
