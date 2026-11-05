"""Database guards shared by metadata-created scratch databases and Alembic."""
from sqlalchemy import event, inspect, text


def install(connection):
    if connection.dialect.name == "postgresql":
        connection.execute(text("""
        CREATE OR REPLACE FUNCTION zea_protect_task_status() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR
            NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.legacy_status IS DISTINCT FROM OLD.legacy_status OR
            NEW.legacy_column_id IS DISTINCT FROM OLD.legacy_column_id OR NEW.is_system IS DISTINCT FROM OLD.is_system) THEN
            RAISE EXCEPTION 'Status identity is protected' USING ERRCODE = '23514';
          END IF;
          IF OLD.is_system AND (TG_OP = 'DELETE') THEN
            RAISE EXCEPTION 'System statuses cannot be deleted';
          END IF;
          IF TG_OP = 'UPDATE' THEN
            IF OLD.is_system AND (NOT NEW.is_system OR NOT NEW.is_active OR
              NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.system_name IS DISTINCT FROM OLD.system_name OR
              NEW.legacy_status IS DISTINCT FROM OLD.legacy_status OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
              RAISE EXCEPTION 'System status identity is protected';
            END IF;
            IF NOT NEW.is_active AND EXISTS (SELECT 1 FROM tasks WHERE custom_status_id = OLD.id) THEN
              RAISE EXCEPTION 'Reassign tasks before archiving';
            END IF;
            RETURN NEW;
          END IF;
          RETURN OLD;
        END $$
        """))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_protect_task_status ON task_statuses"))
        connection.execute(text("CREATE TRIGGER zea_protect_task_status BEFORE UPDATE OR DELETE ON task_statuses FOR EACH ROW EXECUTE FUNCTION zea_protect_task_status()"))
        connection.execute(text("""CREATE OR REPLACE FUNCTION zea_status_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'System status workflow cannot be truncated'; END $$"""))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_status_no_truncate ON task_statuses"))
        connection.execute(text("CREATE TRIGGER zea_status_no_truncate BEFORE TRUNCATE ON task_statuses FOR EACH STATEMENT EXECUTE FUNCTION zea_status_no_truncate()"))
        connection.execute(text("""
        CREATE OR REPLACE FUNCTION zea_validate_task_custom_status() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE task_tenant uuid; status_tenant uuid; active boolean; system_status boolean;
        BEGIN
          IF NEW.status::text <> 'IN_PROGRESS' THEN NEW.custom_status_id := NULL; END IF;
          IF NEW.custom_status_id IS NOT NULL THEN
            SELECT CASE WHEN NEW.project_id IS NOT NULL THEN
              (SELECT tenant_id FROM projects WHERE id = NEW.project_id)
              ELSE (SELECT tenant_id FROM users WHERE id = NEW.created_by_id) END INTO task_tenant;
            SELECT tenant_id, is_active, is_system INTO status_tenant, active, system_status
              FROM task_statuses WHERE id = NEW.custom_status_id FOR SHARE;
            IF status_tenant IS NULL OR status_tenant IS DISTINCT FROM task_tenant OR NOT active OR system_status THEN
              RAISE EXCEPTION 'Custom status is not available for this task workspace';
            END IF;
          END IF;
          RETURN NEW;
        END $$
        """))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_validate_task_custom_status ON tasks"))
        connection.execute(text("CREATE TRIGGER zea_validate_task_custom_status BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION zea_validate_task_custom_status()"))
        connection.execute(text("""CREATE OR REPLACE FUNCTION zea_status_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'Status configuration history is append-only'; END $$"""))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_status_audit_immutable ON status_configuration_audits"))
        connection.execute(text("CREATE TRIGGER zea_status_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON status_configuration_audits FOR EACH STATEMENT EXECUTE FUNCTION zea_status_audit_immutable()"))
    elif connection.dialect.name == "sqlite":
        for name, sql in (
            ("identity", "BEFORE UPDATE ON task_statuses WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.legacy_status IS NOT OLD.legacy_status OR NEW.legacy_column_id IS NOT OLD.legacy_column_id OR NEW.is_system IS NOT OLD.is_system BEGIN SELECT RAISE(ABORT, 'Status identity is protected'); END"),
            ("referenced_delete", "BEFORE DELETE ON task_statuses WHEN EXISTS (SELECT 1 FROM tasks WHERE custom_status_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'Reassign tasks before deleting'); END"),
            ("system_delete", "BEFORE DELETE ON task_statuses WHEN OLD.is_system BEGIN SELECT RAISE(ABORT, 'System statuses cannot be deleted'); END"),
            ("system_update", "BEFORE UPDATE ON task_statuses WHEN OLD.is_system AND (NOT NEW.is_system OR NOT NEW.is_active OR NEW.id != OLD.id OR NEW.code != OLD.code OR NEW.system_name != OLD.system_name OR NEW.legacy_status IS NOT OLD.legacy_status OR NEW.tenant_id != OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'System status identity is protected'); END"),
            ("archive", "BEFORE UPDATE ON task_statuses WHEN NOT NEW.is_active AND EXISTS (SELECT 1 FROM tasks WHERE custom_status_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'Reassign tasks before archiving'); END"),
            ("canonical", "AFTER UPDATE ON tasks WHEN NEW.status != 'IN_PROGRESS' AND NEW.custom_status_id IS NOT NULL BEGIN UPDATE tasks SET custom_status_id = NULL WHERE id = NEW.id; END"),
            ("canonical_insert", "AFTER INSERT ON tasks WHEN NEW.status != 'IN_PROGRESS' AND NEW.custom_status_id IS NOT NULL BEGIN UPDATE tasks SET custom_status_id = NULL WHERE id = NEW.id; END"),
        ):
            connection.execute(text(f"CREATE TRIGGER IF NOT EXISTS zea_status_{name} {sql}"))
        for operation in ("UPDATE", "DELETE"):
            connection.execute(text(f"CREATE TRIGGER IF NOT EXISTS zea_status_audit_immutable_{operation.lower()} BEFORE {operation} ON status_configuration_audits BEGIN SELECT RAISE(ABORT, 'Status configuration history is append-only'); END"))
        for operation in ("INSERT", "UPDATE"):
            connection.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_status_assignment_{operation.lower()}
            BEFORE {operation} ON tasks WHEN NEW.custom_status_id IS NOT NULL AND NEW.status = 'IN_PROGRESS'
            AND NOT EXISTS (SELECT 1 FROM task_statuses s WHERE s.id = NEW.custom_status_id
              AND s.is_active AND NOT s.is_system AND s.tenant_id = CASE WHEN NEW.project_id IS NOT NULL
                THEN (SELECT tenant_id FROM projects WHERE id = NEW.project_id)
                ELSE (SELECT tenant_id FROM users WHERE id = NEW.created_by_id) END)
            BEGIN SELECT RAISE(ABORT, 'Custom status is not available for this task workspace'); END"""))
    install_history(connection)


def install_history(connection):
    """Add custom display moves without changing v1 canonical lifecycle events."""
    inspector = inspect(connection)
    if "task_lifecycle_events" not in inspector.get_table_names():
        return
    required = {"tenant_id", "task_id", "subtask_id", "time_entry_id", "event_type", "previous_status", "new_status",
                "actor_id", "occurred_at", "recorded_at", "details"}
    if not required.issubset({col["name"] for col in inspector.get_columns("task_lifecycle_events")}):
        return
    from .lifecycle.schema_v1 import _expressions, _json
    dialect = connection.dialect.name
    _, tenant, actor, now = _expressions(dialect, "tasks")
    def details(previous):
        old_id = "OLD.custom_status_id" if previous else "NULL"
        return _json(dialect, {
            "previous_custom_status_id": old_id, "new_custom_status_id": "NEW.custom_status_id",
            "previous_custom_label": f"(SELECT display_label FROM task_statuses WHERE id={old_id})",
            "new_custom_label": "(SELECT display_label FROM task_statuses WHERE id=NEW.custom_status_id)",
            "previous_custom_code": f"(SELECT code FROM task_statuses WHERE id={old_id})",
            "new_custom_code": "(SELECT code FROM task_statuses WHERE id=NEW.custom_status_id)",
        })
    fields = "tenant_id,task_id,subtask_id,time_entry_id,event_type,previous_status,new_status,actor_id,occurred_at,recorded_at,details"
    if dialect == "postgresql":
        connection.execute(text(f"""CREATE OR REPLACE FUNCTION zea_custom_status_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'INSERT' AND NEW.custom_status_id IS NOT NULL THEN
            INSERT INTO task_lifecycle_events ({fields}) VALUES ({tenant},NEW.id,NULL,NULL,'task.custom_status_changed',NULL,NEW.status::text,{actor},{now},{now},{details(False)});
          ELSIF TG_OP = 'UPDATE' AND OLD.custom_status_id IS DISTINCT FROM NEW.custom_status_id THEN
            INSERT INTO task_lifecycle_events ({fields}) VALUES ({tenant},NEW.id,NULL,NULL,'task.custom_status_changed',OLD.status::text,NEW.status::text,{actor},{now},{now},{details(True)});
          END IF;
          RETURN NULL;
        END $$"""))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_custom_status_history ON tasks"))
        connection.execute(text("CREATE TRIGGER zea_custom_status_history AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION zea_custom_status_history()"))
    elif dialect == "sqlite":
        for operation, condition, previous in (
            ("insert", "NEW.custom_status_id IS NOT NULL AND NEW.status = 'IN_PROGRESS'", "NULL"),
            ("update", "OLD.custom_status_id IS NOT NEW.custom_status_id", "OLD.status"),
        ):
            connection.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_custom_status_history_{operation}
            AFTER {operation.upper()} ON tasks WHEN {condition} BEGIN
              INSERT INTO task_lifecycle_events ({fields}) VALUES ({tenant},NEW.id,NULL,NULL,'task.custom_status_changed',{previous},NEW.status,{actor},{now},{now},{details(operation == 'update')});
            END"""))


def uninstall_history(connection):
    """Remove only the newer custom-move capture when emulating a pre-v1 schema."""
    if connection.dialect.name == "postgresql":
        connection.execute(text("DROP TRIGGER IF EXISTS zea_custom_status_history ON tasks"))
        connection.execute(text("DROP FUNCTION IF EXISTS zea_custom_status_history()"))
    elif connection.dialect.name == "sqlite":
        for operation in ("insert", "update"):
            connection.execute(text(f"DROP TRIGGER IF EXISTS zea_custom_status_history_{operation}"))


def register(metadata):
    @event.listens_for(metadata, "after_create")
    def guards(metadata, connection, tables, **kwargs):
        if any(table.name == "task_statuses" for table in tables) and "tasks" in inspect(connection).get_table_names():
            install(connection)


def register_task_identity_guard(task_class):
    # Keep the ORM identity map aligned with the SQL trigger for all existing
    # completion/subtask flows, including those outside the task router.
    @event.listens_for(task_class.status, "set")
    def canonical_status(task, value, oldvalue, initiator):
        if value != "IN_PROGRESS":
            task.custom_status_id = None
