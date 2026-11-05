"""Versioned Phase 3 data guards and hold ledger. Do not edit earlier migrations."""
from sqlalchemy import event, inspect, text


def behavior_case(column):
    return f"CASE {column} WHEN 'WAITING_FOR_REQUIREMENT' THEN 'PENDING' WHEN 'TODO' THEN 'PENDING' WHEN 'ON_HOLD' THEN 'HOLD' WHEN 'DONE' THEN 'COMPLETED' WHEN 'DEPLOYED' THEN 'COMPLETED' ELSE 'ACTIVE' END"


def native_case(column):
    return f"CASE {column} WHEN 'PENDING' THEN 'WAITING_FOR_REQUIREMENT' WHEN 'HOLD' THEN 'ON_HOLD' ELSE 'IN_PROGRESS' END"


def install(connection):
    if 'task_hold_intervals' not in inspect(connection).get_table_names():
        return
    if connection.dialect.name == 'postgresql':
        _postgres(connection)
    else:
        _sqlite(connection)


def _postgres(c):
    c.execute(text(f"""CREATE OR REPLACE FUNCTION zea_behavior_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.workflow_behavior NOT IN ('PENDING','ACTIVE','HOLD','COMPLETED') OR
        (NEW.is_system AND NEW.workflow_behavior <> {behavior_case('NEW.legacy_status')}) OR
        (NOT NEW.is_system AND NEW.workflow_behavior = 'COMPLETED') THEN
        RAISE EXCEPTION 'This workflow behavior is not approved' USING ERRCODE='23514';
      END IF;
      IF TG_OP='UPDATE' AND NEW.workflow_behavior IS DISTINCT FROM OLD.workflow_behavior AND
        EXISTS(SELECT 1 FROM tasks WHERE custom_status_id=OLD.id) THEN
        RAISE EXCEPTION 'Reassign tasks before changing workflow behavior' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$"""))
    c.execute(text('DROP TRIGGER IF EXISTS zea_behavior_guard ON task_statuses'))
    c.execute(text('CREATE TRIGGER zea_behavior_guard BEFORE INSERT OR UPDATE ON task_statuses FOR EACH ROW EXECUTE FUNCTION zea_behavior_guard()'))
    c.execute(text(f"""CREATE OR REPLACE FUNCTION zea_validate_task_custom_status() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE task_tenant uuid; destination task_statuses%ROWTYPE; expected text;
    BEGIN
      IF NEW.custom_status_id IS NULL THEN RETURN NEW; END IF;
      SELECT * INTO destination FROM task_statuses WHERE id=NEW.custom_status_id FOR SHARE;
      task_tenant := CASE WHEN NEW.project_id IS NOT NULL THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id)
        ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END;
      IF destination.id IS NULL OR destination.tenant_id IS DISTINCT FROM task_tenant OR NOT destination.is_active OR destination.is_system THEN
        RAISE EXCEPTION 'Custom status is not available for this task workspace';
      END IF;
      expected := {native_case('destination.workflow_behavior')};
      IF NEW.status::text <> expected THEN
        IF TG_OP='UPDATE' AND NEW.custom_status_id IS NOT DISTINCT FROM OLD.custom_status_id AND NEW.status IS DISTINCT FROM OLD.status THEN
          NEW.custom_status_id := NULL;
        ELSE RAISE EXCEPTION 'Custom status business behavior does not match task status'; END IF;
      END IF;
      RETURN NEW;
    END $$"""))
    # The existing BEFORE task assignment trigger invokes the replaced function.
    c.execute(text("""CREATE OR REPLACE FUNCTION zea_hold_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Hold history is append-only'; END IF;
      IF TG_OP='UPDATE' THEN
        IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL OR
          (to_jsonb(NEW)-'ended_at'-'ended_by_id') IS DISTINCT FROM (to_jsonb(OLD)-'ended_at'-'ended_by_id') THEN
          RAISE EXCEPTION 'Hold history is append-only';
        END IF;
      ELSE
        PERFORM t.id FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.created_by_id
          WHERE t.id=NEW.task_id AND NEW.tenant_id=CASE WHEN t.project_id IS NOT NULL THEN p.tenant_id ELSE u.tenant_id END FOR UPDATE OF t;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hold history must belong to its task workspace'; END IF;
        IF EXISTS(SELECT 1 FROM task_hold_intervals h WHERE h.task_id=NEW.task_id
          AND h.started_at < COALESCE(NEW.ended_at, 'infinity'::timestamp)
          AND COALESCE(h.ended_at, 'infinity'::timestamp) > NEW.started_at) THEN
          RAISE EXCEPTION 'Hold intervals cannot overlap';
        END IF;
      END IF;
      RETURN NEW;
    END $$"""))
    c.execute(text('DROP TRIGGER IF EXISTS zea_hold_ledger_guard ON task_hold_intervals'))
    c.execute(text('CREATE TRIGGER zea_hold_ledger_guard BEFORE INSERT OR UPDATE OR DELETE ON task_hold_intervals FOR EACH ROW EXECUTE FUNCTION zea_hold_ledger_guard()'))
    c.execute(text("""CREATE OR REPLACE FUNCTION zea_hold_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Hold history is append-only'; END $$"""))
    c.execute(text('DROP TRIGGER IF EXISTS zea_hold_no_truncate ON task_hold_intervals'))
    c.execute(text('CREATE TRIGGER zea_hold_no_truncate BEFORE TRUNCATE ON task_hold_intervals FOR EACH STATEMENT EXECUTE FUNCTION zea_hold_no_truncate()'))
    c.execute(text("""CREATE OR REPLACE FUNCTION zea_hold_capture() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE at_time timestamp; actor text; tenant uuid;
    BEGIN
      actor := nullif(current_setting('zea.lifecycle_actor',true),'');
      IF TG_OP='DELETE' THEN
        UPDATE task_hold_intervals SET ended_at=GREATEST(started_at,timezone('UTC',clock_timestamp())), ended_by_id=actor
          WHERE task_id=OLD.id AND ended_at IS NULL;
        RETURN NULL;
      END IF;
      IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
      at_time := CASE WHEN TG_OP='INSERT' THEN COALESCE(NEW.status_transitioned_at,timezone('UTC',clock_timestamp()))
        WHEN NEW.status_transition_version IS DISTINCT FROM OLD.status_transition_version THEN COALESCE(NEW.status_transitioned_at,timezone('UTC',clock_timestamp()))
        ELSE timezone('UTC',clock_timestamp()) END;
      IF NEW.status::text='ON_HOLD' THEN
        tenant := CASE WHEN NEW.project_id IS NOT NULL THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id)
          ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END;
        IF EXISTS(SELECT 1 FROM task_status_scopes WHERE tenant_id=tenant AND hold_reason_required) AND length(trim(COALESCE(NEW.hold_reason,'')))=0 THEN
          RAISE EXCEPTION 'A hold reason is required' USING ERRCODE='23514';
        END IF;
        INSERT INTO task_hold_intervals(id,tenant_id,task_id,started_at,started_by_id,previous_status,previous_custom_status_id,original_due_at,reason,source)
          VALUES(md5(random()::text||clock_timestamp()::text),tenant,NEW.id,at_time,actor,COALESCE(OLD.status::text,'WAITING_FOR_REQUIREMENT'),OLD.custom_status_id,NEW.due_at,NEW.hold_reason,'transition');
        UPDATE tasks SET hold_started_at=at_time,hold_previous_status=COALESCE(OLD.status::text,'WAITING_FOR_REQUIREMENT'),status_transitioned_at=at_time WHERE id=NEW.id;
      ELSIF TG_OP='UPDATE' AND OLD.status::text='ON_HOLD' THEN
        UPDATE task_hold_intervals SET ended_at=GREATEST(started_at,at_time),ended_by_id=actor WHERE task_id=NEW.id AND ended_at IS NULL;
        UPDATE tasks SET hold_started_at=NULL,status_transitioned_at=at_time,
          hold_paused_seconds=COALESCE((SELECT sum(EXTRACT(EPOCH FROM ended_at-started_at)) FROM task_hold_intervals WHERE task_id=NEW.id AND ended_at IS NOT NULL),0) WHERE id=NEW.id;
      END IF;
      RETURN NULL;
    END $$"""))
    c.execute(text('DROP TRIGGER IF EXISTS zea_hold_capture ON tasks'))
    c.execute(text('CREATE TRIGGER zea_hold_capture AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION zea_hold_capture()'))


def _sqlite(c):
    for name in ('canonical','canonical_insert','assignment_insert','assignment_update'):
        c.execute(text(f'DROP TRIGGER IF EXISTS zea_status_{name}'))
    for operation in ('insert','update'):
        allowed_native_change = "AND NOT (NEW.custom_status_id IS OLD.custom_status_id AND NEW.status IS NOT OLD.status)" if operation == 'update' else ''
        c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_behavior_guard_{operation} BEFORE {operation.upper()} ON task_statuses
        WHEN NEW.workflow_behavior NOT IN ('PENDING','ACTIVE','HOLD','COMPLETED') OR
          (NEW.is_system AND NEW.workflow_behavior <> {behavior_case('NEW.legacy_status')}) OR
          (NOT NEW.is_system AND NEW.workflow_behavior='COMPLETED')
        BEGIN SELECT RAISE(ABORT,'This workflow behavior is not approved'); END"""))
        c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_behavior_assignment_{operation} BEFORE {operation.upper()} ON tasks
        WHEN NEW.custom_status_id IS NOT NULL {allowed_native_change} AND NOT EXISTS (SELECT 1 FROM task_statuses s WHERE s.id=NEW.custom_status_id
          AND s.is_active AND NOT s.is_system AND NEW.status={native_case('s.workflow_behavior')} AND s.tenant_id=CASE WHEN NEW.project_id IS NOT NULL
          THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id) ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END)
        BEGIN SELECT RAISE(ABORT,'Custom status is not available for this task workspace'); END"""))
    c.execute(text("""CREATE TRIGGER IF NOT EXISTS zea_behavior_change BEFORE UPDATE ON task_statuses
      WHEN NEW.workflow_behavior IS NOT OLD.workflow_behavior AND EXISTS(SELECT 1 FROM tasks WHERE custom_status_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Reassign tasks before changing workflow behavior'); END"""))
    c.execute(text("""CREATE TRIGGER IF NOT EXISTS zea_hold_immutable_update BEFORE UPDATE ON task_hold_intervals
      WHEN OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR
        NEW.task_id IS NOT OLD.task_id OR NEW.started_at IS NOT OLD.started_at OR NEW.started_by_id IS NOT OLD.started_by_id OR
        NEW.previous_status IS NOT OLD.previous_status OR NEW.previous_custom_status_id IS NOT OLD.previous_custom_status_id OR
        NEW.original_due_at IS NOT OLD.original_due_at OR NEW.reason IS NOT OLD.reason OR NEW.source IS NOT OLD.source
      BEGIN SELECT RAISE(ABORT,'Hold history is append-only'); END"""))
    c.execute(text("""CREATE TRIGGER IF NOT EXISTS zea_hold_immutable_delete BEFORE DELETE ON task_hold_intervals
      BEGIN SELECT RAISE(ABORT,'Hold history is append-only'); END"""))
    c.execute(text("""CREATE TRIGGER IF NOT EXISTS zea_hold_overlap BEFORE INSERT ON task_hold_intervals
      WHEN EXISTS(SELECT 1 FROM task_hold_intervals h WHERE h.task_id=NEW.task_id
        AND h.started_at<COALESCE(NEW.ended_at,'9999-12-31') AND COALESCE(h.ended_at,'9999-12-31')>NEW.started_at)
      BEGIN SELECT RAISE(ABORT,'Hold intervals cannot overlap'); END"""))
    c.execute(text("""CREATE TRIGGER IF NOT EXISTS zea_hold_tenant BEFORE INSERT ON task_hold_intervals
      WHEN NOT EXISTS(SELECT 1 FROM tasks t LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.created_by_id
        WHERE t.id=NEW.task_id AND NEW.tenant_id=CASE WHEN t.project_id IS NOT NULL THEN p.tenant_id ELSE u.tenant_id END)
      BEGIN SELECT RAISE(ABORT,'Hold history must belong to its task workspace'); END"""))
    now = "strftime('%Y-%m-%d %H:%M:%f','now')"
    tenant = "CASE WHEN NEW.project_id IS NOT NULL THEN (SELECT tenant_id FROM projects WHERE id=NEW.project_id) ELSE (SELECT tenant_id FROM users WHERE id=NEW.created_by_id) END"
    for operation in ('insert','update'):
        entering = "NEW.status='ON_HOLD'" + (" AND OLD.status<>'ON_HOLD'" if operation=='update' else '')
        at = f"COALESCE(NEW.status_transitioned_at,{now})" if operation=='insert' else f"CASE WHEN NEW.status_transition_version IS NOT OLD.status_transition_version THEN COALESCE(NEW.status_transitioned_at,{now}) ELSE {now} END"
        previous = "OLD.status" if operation=='update' else "'WAITING_FOR_REQUIREMENT'"
        custom = "OLD.custom_status_id" if operation=='update' else 'NULL'
        c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_hold_enter_{operation} AFTER {operation.upper()} ON tasks WHEN {entering} BEGIN
          SELECT CASE WHEN EXISTS(SELECT 1 FROM task_status_scopes WHERE tenant_id={tenant} AND hold_reason_required)
            AND length(trim(COALESCE(NEW.hold_reason,'')))=0 THEN RAISE(ABORT,'A hold reason is required') END;
          INSERT INTO task_hold_intervals(id,tenant_id,task_id,started_at,started_by_id,previous_status,previous_custom_status_id,original_due_at,reason,source)
            VALUES(lower(hex(randomblob(16))),{tenant},NEW.id,{at},zea_lifecycle_actor(),{previous},{custom},NEW.due_at,NEW.hold_reason,'transition');
          UPDATE tasks SET hold_started_at={at},hold_previous_status={previous},status_transitioned_at={at} WHERE id=NEW.id;
        END"""))
    c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_hold_exit AFTER UPDATE ON tasks WHEN OLD.status='ON_HOLD' AND NEW.status<>'ON_HOLD' BEGIN
      UPDATE task_hold_intervals SET ended_at=max(started_at,CASE WHEN NEW.status_transition_version IS NOT OLD.status_transition_version THEN COALESCE(NEW.status_transitioned_at,{now}) ELSE {now} END),ended_by_id=zea_lifecycle_actor() WHERE task_id=NEW.id AND ended_at IS NULL;
      UPDATE tasks SET hold_started_at=NULL,hold_paused_seconds=COALESCE((SELECT sum((julianday(ended_at)-julianday(started_at))*86400.0) FROM task_hold_intervals WHERE task_id=NEW.id AND ended_at IS NOT NULL),0) WHERE id=NEW.id;
    END"""))
    c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_hold_deleted AFTER DELETE ON tasks BEGIN
      UPDATE task_hold_intervals SET ended_at=max(started_at,{now}),ended_by_id=zea_lifecycle_actor() WHERE task_id=OLD.id AND ended_at IS NULL;
    END"""))
    c.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_behavior_canonical AFTER UPDATE ON tasks
      WHEN NEW.custom_status_id IS NOT NULL AND NEW.status IS NOT (SELECT {native_case('s.workflow_behavior')} FROM task_statuses s WHERE s.id=NEW.custom_status_id)
      BEGIN UPDATE tasks SET custom_status_id=NULL WHERE id=NEW.id; END"""))
    history = c.scalar(text("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='zea_custom_status_history_insert'"))
    if history:
        c.execute(text('DROP TRIGGER zea_custom_status_history_insert'))
        c.execute(text(history.replace(" AND NEW.status = 'IN_PROGRESS'", '')))


def register(metadata):
    @event.listens_for(metadata, 'after_create')
    def guards(metadata, connection, tables, **kwargs):
        if any(table.name == 'task_hold_intervals' for table in tables):
            install(connection)


def uninstall(connection):
    """Only for isolated old-schema fixtures; the migration downgrade is guarded."""
    if connection.dialect.name == 'postgresql':
        for trigger, table in [('zea_behavior_guard','task_statuses'),('zea_hold_ledger_guard','task_hold_intervals'),
                               ('zea_hold_no_truncate','task_hold_intervals'),('zea_hold_capture','tasks')]:
            connection.execute(text(f'DROP TRIGGER IF EXISTS {trigger} ON {table}'))
        for function in ('zea_behavior_guard','zea_hold_ledger_guard','zea_hold_no_truncate','zea_hold_capture'):
            connection.execute(text(f'DROP FUNCTION IF EXISTS {function}()'))
    else:
        for name in ('zea_behavior_guard_insert','zea_behavior_guard_update','zea_behavior_assignment_insert',
                     'zea_behavior_assignment_update','zea_behavior_change','zea_behavior_canonical',
                     'zea_hold_immutable_update','zea_hold_immutable_delete','zea_hold_overlap','zea_hold_tenant',
                     'zea_hold_enter_insert','zea_hold_enter_update','zea_hold_exit','zea_hold_deleted'):
            connection.execute(text(f'DROP TRIGGER IF EXISTS {name}'))
