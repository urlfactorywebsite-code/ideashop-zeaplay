"""Frozen Phase 2 guard: registered system statuses always remain on the board."""
from sqlalchemy import event, inspect, text


def install(connection):
    if connection.dialect.name == "postgresql":
        connection.execute(text("""CREATE OR REPLACE FUNCTION zea_kanban_system_visible() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.is_system AND NOT NEW.kanban_visible THEN
            RAISE EXCEPTION 'System statuses must remain visible on Kanban' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END $$"""))
        connection.execute(text("DROP TRIGGER IF EXISTS zea_kanban_system_visible ON task_statuses"))
        connection.execute(text("CREATE TRIGGER zea_kanban_system_visible BEFORE INSERT OR UPDATE ON task_statuses FOR EACH ROW EXECUTE FUNCTION zea_kanban_system_visible()"))
    elif connection.dialect.name == "sqlite":
        for operation in ("insert", "update"):
            connection.execute(text(f"""CREATE TRIGGER IF NOT EXISTS zea_kanban_system_visible_{operation}
            BEFORE {operation.upper()} ON task_statuses WHEN NEW.is_system AND NOT NEW.kanban_visible
            BEGIN SELECT RAISE(ABORT, 'System statuses must remain visible on Kanban'); END"""))


def uninstall(connection):
    if connection.dialect.name == "postgresql":
        connection.execute(text("DROP TRIGGER IF EXISTS zea_kanban_system_visible ON task_statuses"))
        connection.execute(text("DROP FUNCTION IF EXISTS zea_kanban_system_visible()"))
    elif connection.dialect.name == "sqlite":
        for operation in ("insert", "update"):
            connection.execute(text(f"DROP TRIGGER IF EXISTS zea_kanban_system_visible_{operation}"))


def register(metadata):
    @event.listens_for(metadata, "after_create")
    def guards(metadata, connection, tables, **kwargs):
        if any(table.name == "task_statuses" for table in tables) and "task_statuses" in inspect(connection).get_table_names():
            install(connection)
