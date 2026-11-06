"""Owner-managed legacy visibility/activation; native identities remain immutable."""
from sqlalchemy import event, inspect, text

CORE_SQL = "'BATTLE_PLAN','IN_PROGRESS','ON_HOLD','CONQUERED'"


def install(c):
    if c.dialect.name == 'postgresql':
        c.execute(text(f"""CREATE OR REPLACE FUNCTION zea_protect_task_status() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='DELETE' THEN
            IF OLD.is_system THEN RAISE EXCEPTION 'System statuses cannot be deleted'; END IF;
            RETURN OLD;
          END IF;
          IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR
             NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.legacy_status IS DISTINCT FROM OLD.legacy_status OR
             NEW.legacy_column_id IS DISTINCT FROM OLD.legacy_column_id OR NEW.is_system IS DISTINCT FROM OLD.is_system OR
             (OLD.is_system AND NEW.system_name IS DISTINCT FROM OLD.system_name) OR
             (OLD.is_system AND OLD.code IN ({CORE_SQL}) AND NOT NEW.is_active) THEN
            RAISE EXCEPTION 'System status identity is protected' USING ERRCODE='23514';
          END IF;
          IF NOT NEW.is_active AND EXISTS(SELECT 1 FROM tasks WHERE custom_status_id=OLD.id) THEN
            RAISE EXCEPTION 'Reassign tasks before archiving';
          END IF;
          RETURN NEW;
        END $$"""))
        c.execute(text(f"""CREATE OR REPLACE FUNCTION zea_kanban_system_visible() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.is_system AND NEW.code IN ({CORE_SQL}) AND (NOT NEW.kanban_visible OR NOT NEW.is_active) THEN
            RAISE EXCEPTION 'Core system statuses must remain visible and active on Kanban' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$"""))
        c.execute(text("""CREATE OR REPLACE FUNCTION zea_native_status_available() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE destination task_statuses%ROWTYPE; task_tenant uuid;
        BEGIN
          IF NEW.custom_status_id IS NOT NULL THEN RETURN NEW; END IF;
          IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND
             NEW.custom_status_id IS NOT DISTINCT FROM OLD.custom_status_id AND
             NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND NEW.created_by_id IS NOT DISTINCT FROM OLD.created_by_id THEN
            RETURN NEW;
          END IF;
          task_tenant := CASE WHEN NEW.project_id IS NOT NULL THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id)
            ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END;
          SELECT * INTO destination FROM task_statuses WHERE tenant_id=task_tenant AND legacy_status=NEW.status::text FOR SHARE;
          IF FOUND AND NOT destination.is_active THEN
            RAISE EXCEPTION 'Task status is inactive for this workspace' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$"""))
        # PostgreSQL runs same-event triggers by name. Validate after the custom
        # guard canonicalizes a legacy move and clears its previous custom ID.
        c.execute(text('DROP TRIGGER IF EXISTS zea_zz_native_status_available ON tasks'))
        c.execute(text('CREATE TRIGGER zea_zz_native_status_available BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION zea_native_status_available()'))
    elif c.dialect.name == 'sqlite':
        c.execute(text('DROP TRIGGER IF EXISTS zea_status_system_update'))
        c.execute(text(f"""CREATE TRIGGER zea_status_system_update BEFORE UPDATE ON task_statuses
          WHEN OLD.is_system AND (NEW.system_name IS NOT OLD.system_name OR
            (OLD.code IN ({CORE_SQL}) AND NOT NEW.is_active))
          BEGIN SELECT RAISE(ABORT,'System status identity is protected'); END"""))
        for operation in ('insert', 'update'):
            c.execute(text(f'DROP TRIGGER IF EXISTS zea_kanban_system_visible_{operation}'))
            c.execute(text(f"""CREATE TRIGGER zea_kanban_system_visible_{operation} BEFORE {operation.upper()} ON task_statuses
              WHEN NEW.is_system AND NEW.code IN ({CORE_SQL}) AND (NOT NEW.kanban_visible OR NOT NEW.is_active)
              BEGIN SELECT RAISE(ABORT,'Core system statuses must remain visible and active on Kanban'); END"""))
            changed = "" if operation == 'insert' else "AND (NEW.status IS NOT OLD.status OR NEW.custom_status_id IS NOT OLD.custom_status_id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_by_id IS NOT OLD.created_by_id)"
            c.execute(text(f'DROP TRIGGER IF EXISTS zea_native_status_available_{operation}'))
            c.execute(text(f"""CREATE TRIGGER zea_native_status_available_{operation} BEFORE {operation.upper()} ON tasks
              WHEN NEW.custom_status_id IS NULL {changed} AND EXISTS(SELECT 1 FROM task_statuses s
                WHERE s.legacy_status=NEW.status AND NOT s.is_active AND s.tenant_id=CASE WHEN NEW.project_id IS NOT NULL
                  THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id)
                  ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END)
              BEGIN SELECT RAISE(ABORT,'Task status is inactive for this workspace'); END"""))


def uninstall(c):
    if c.dialect.name == 'postgresql':
        c.execute(text('DROP TRIGGER IF EXISTS zea_zz_native_status_available ON tasks'))
        c.execute(text('DROP FUNCTION IF EXISTS zea_native_status_available()'))
    else:
        c.execute(text('DROP TRIGGER IF EXISTS zea_status_system_update'))
        for operation in ('insert', 'update'):
            c.execute(text(f'DROP TRIGGER IF EXISTS zea_native_status_available_{operation}'))
            c.execute(text(f'DROP TRIGGER IF EXISTS zea_kanban_system_visible_{operation}'))


def register(metadata):
    @event.listens_for(metadata, 'after_create')
    def guards(metadata, connection, tables, **kwargs):
        if any(table.name == 'task_statuses' for table in tables) and 'tasks' in inspect(connection).get_table_names():
            install(connection)
