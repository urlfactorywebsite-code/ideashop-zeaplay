"""Frozen v1 lifecycle trigger definition, shared by migration and metadata bootstrap.

Keep this version immutable once released; future schema changes need a new version.
Triggers capture ORM, bulk, import, maintenance and direct SQL mutations atomically.
"""
from sqlalchemy import event, inspect, text


TABLES = ("tasks", "subtasks", "time_entries")


def _execute(connection, sql):
    # Preserve the v1 SQL verbatim while supporting Alembic's offline MockConnection.
    execute = getattr(connection, "exec_driver_sql", None)
    return execute(sql) if execute else connection.execute(text(sql))


def _expressions(dialect, table, row="NEW"):
    pg = dialect == "postgresql"
    root = f"{row}.id" if table == "tasks" else (
        f"{row}.task_id" if table == "subtasks" else
        f"COALESCE({row}.task_id, (SELECT task_id FROM subtasks WHERE id = {row}.subtask_id), "
        f"(SELECT task_id FROM task_lifecycle_events WHERE subtask_id = {row}.subtask_id ORDER BY id DESC LIMIT 1))")
    tenant = (f"COALESCE((SELECT COALESCE(p.tenant_id, u.tenant_id) FROM tasks t "
              f"LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by_id WHERE t.id = {root}), "
              f"(SELECT tenant_id FROM task_lifecycle_events WHERE task_id = {root} ORDER BY id DESC LIMIT 1))")
    if table == "time_entries":
        tenant = f"{row}.tenant_id"
    actor_setting = "NULLIF(current_setting('zea.lifecycle_actor', true), '')" if pg else "zea_lifecycle_actor()"
    actor = actor_setting
    now = "clock_timestamp()" if pg else "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    return root, tenant, actor, now


def _json(dialect, pairs):
    function = "json_build_object" if dialect == "postgresql" else "json_object"
    return function + "(" + ", ".join(f"'{key}', {value}" for key, value in pairs.items()) + ")"


def _timer_details(dialect, operation):
    current = "OLD" if operation == "DELETE" else "NEW"
    pairs = {"user_id": f"{current}.user_id", "continued_from_id": f"{current}.continued_from_id"}
    for row in (["OLD", "NEW"] if operation == "UPDATE" else [current]):
        for key in ("started_at", "stopped_at", "duration_seconds"):
            value = f"{row}.{key}"
            if dialect == "postgresql" and key != "duration_seconds":
                value = f"to_char({value} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
            pairs[f"{row.lower()}_{key}"] = value
    return _json(dialect, pairs)


def _insert(dialect, table, operation):
    row = "OLD" if operation == "DELETE" else "NEW"
    root, tenant, actor, now = _expressions(dialect, table, row)
    subtask = "NULL" if table == "tasks" else f"{row}.id" if table == "subtasks" else f"{row}.subtask_id"
    entry = f"{row}.id" if table == "time_entries" else "NULL"
    previous = "NULL" if operation == "INSERT" else "OLD.status"
    current = "NULL" if operation == "DELETE" else "NEW.status"
    if dialect == "postgresql":
        previous += "::text"
        current += "::text"
    kind = "task" if table == "tasks" else "subtask" if table == "subtasks" else "timer"
    event_type = f"'{kind}.{'created' if operation == 'INSERT' else 'deleted' if operation == 'DELETE' else 'status_changed'}'"
    occurred = now
    stored_created_at = ("to_char(NEW.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
                         if dialect == "postgresql" else "NEW.created_at")
    details = _json(dialect, {"creator_id": "NEW.created_by_id", "stored_created_at": stored_created_at}) if table == "tasks" and operation == "INSERT" else _json(dialect, {})
    if table == "time_entries":
        details = _timer_details(dialect, operation)
        if operation == "INSERT":
            event_type = "CASE NEW.start_kind WHEN 'resumed' THEN 'timer.resumed' WHEN 'restarted' THEN 'timer.restarted' ELSE 'timer.started' END"
        elif operation == "UPDATE":
            event_type = ("CASE WHEN OLD.stopped_at IS NULL AND NEW.stopped_at IS NOT NULL "
                          "THEN CASE WHEN NEW.stop_reason = 'paused' THEN 'timer.paused' ELSE 'timer.stopped' END "
                          "ELSE 'timer.corrected' END")
    return ("INSERT INTO task_lifecycle_events "
            "(tenant_id, task_id, subtask_id, time_entry_id, event_type, previous_status, new_status, actor_id, occurred_at, recorded_at, details) "
            f"VALUES ({tenant}, {root}, {subtask}, {entry}, {event_type}, {previous}, {current}, {actor}, {occurred}, {now}, {details});")


def install(connection):
    dialect = connection.dialect.name
    if dialect not in {"postgresql", "sqlite"}:
        raise RuntimeError("Lifecycle capture supports PostgreSQL and SQLite only")
    for table in TABLES:
        changed = "OLD.status IS DISTINCT FROM NEW.status" if dialect == "postgresql" else "OLD.status IS NOT NEW.status"
        if table == "time_entries":
            operator = "IS DISTINCT FROM" if dialect == "postgresql" else "IS NOT"
            changed = " OR ".join(f"OLD.{column} {operator} NEW.{column}" for column in
                                  ("started_at", "stopped_at", "duration_seconds", "corrected_at", "status"))
        if dialect == "postgresql":
            body = (f"IF TG_OP = 'INSERT' THEN {_insert(dialect, table, 'INSERT')} "
                    f"ELSIF TG_OP = 'DELETE' THEN {_insert(dialect, table, 'DELETE')} "
                    f"ELSIF {changed} THEN {_insert(dialect, table, 'UPDATE')} END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NULL;")
            _execute(connection, f"CREATE OR REPLACE FUNCTION zea_lifecycle_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN {body} END $$")
            _execute(connection, f"CREATE TRIGGER zea_lifecycle_{table} AFTER INSERT OR UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION zea_lifecycle_{table}()")
            _execute(connection, f"CREATE TRIGGER zea_lifecycle_{table}_delete BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION zea_lifecycle_{table}()")
        else:
            for operation in ("INSERT", "UPDATE", "DELETE"):
                condition = f" WHEN {changed}" if operation == "UPDATE" else ""
                timing = "BEFORE" if operation == "DELETE" else "AFTER"
                _execute(connection, f"CREATE TRIGGER zea_lifecycle_{table}_{operation.lower()} {timing} {operation} ON {table} FOR EACH ROW{condition} BEGIN {_insert(dialect, table, operation)} END")
    if dialect == "postgresql":
        _execute(connection, "CREATE FUNCTION zea_lifecycle_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Lifecycle history is append-only'; END $$")
        for table in ("task_lifecycle_events", "task_lifecycle_coverage"):
            _execute(connection, f"CREATE TRIGGER zea_lifecycle_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION zea_lifecycle_immutable()")
    else:
        for table in ("task_lifecycle_events", "task_lifecycle_coverage"):
            for operation in ("UPDATE", "DELETE"):
                _execute(connection, f"CREATE TRIGGER zea_lifecycle_immutable_{table}_{operation.lower()} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'Lifecycle history is append-only'); END")
    now = _expressions(dialect, "tasks")[3]
    _execute(connection, f"INSERT INTO task_lifecycle_coverage (id, started_at) VALUES (1, {now})")


def uninstall(connection):
    if connection.dialect.name == "postgresql":
        for table in TABLES:
            _execute(connection, f"DROP TRIGGER zea_lifecycle_{table} ON {table}")
            _execute(connection, f"DROP TRIGGER zea_lifecycle_{table}_delete ON {table}")
            _execute(connection, f"DROP FUNCTION zea_lifecycle_{table}()")
        for table in ("task_lifecycle_events", "task_lifecycle_coverage"):
            _execute(connection, f"DROP TRIGGER zea_lifecycle_immutable ON {table}")
        _execute(connection, "DROP FUNCTION zea_lifecycle_immutable()")
    else:
        for table in TABLES:
            for operation in ("insert", "update", "delete"):
                _execute(connection, f"DROP TRIGGER zea_lifecycle_{table}_{operation}")


def register_metadata(metadata):
    @event.listens_for(metadata, "after_create")
    def _install(metadata, connection, tables, **kwargs):
        if any(table.name == "task_lifecycle_events" for table in tables):
            if set(TABLES).issubset(inspect(connection).get_table_names()):
                install(connection)
