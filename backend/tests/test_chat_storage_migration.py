"""The additive storage migration preserves existing users and conversations."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_storage_migration_preserves_existing_records_and_supports_bootstrap(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/fff5c6d7e8f9_chat_upload_storage.py"
    spec = importlib.util.spec_from_file_location("chat_storage_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO users VALUES ('preserved-user')"))
        connection.execute(sa.text("INSERT INTO chat_conversations VALUES ('preserved-chat')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()  # Bootstrap may have already created the table.
        assert connection.execute(sa.text("SELECT id FROM users")).scalar_one() == "preserved-user"
        assert connection.execute(sa.text("SELECT id FROM chat_conversations")).scalar_one() == "preserved-chat"
        columns = {column["name"] for column in sa.inspect(connection).get_columns("chat_uploads")}
        assert {"user_id", "tenant_id", "file_size", "storage_key"} <= columns
        assert connection.execute(sa.text("SELECT COUNT(*) FROM chat_uploads")).scalar_one() == 0
    engine.dispose()
