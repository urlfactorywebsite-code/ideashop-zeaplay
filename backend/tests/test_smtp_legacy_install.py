"""The real migration on disposable PostgreSQL schemas; synthetic credentials only."""
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from backend.app.services.smtp_install import install


@pytest.fixture
def legacy():
    url = os.environ.get('ZEAPLAY_RT_POSTGRES_TEST_URL')
    if not url:
        pytest.skip('Explicit disposable PostgreSQL test database required')
    assert 'rt3_test' in make_url(url).database
    admin = create_engine(url)
    schema = 'smtp_legacy_' + uuid4().hex
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(make_url(url).update_query_dict({'options': f'-csearch_path={schema},public'}))
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE smtp_config (id integer primary key,host varchar(255),port integer,username varchar(255),password varchar(255),encryption varchar(50))')
        connection.exec_driver_sql('CREATE TABLE multiple_smtp_configs (id varchar(36) primary key,name varchar(255),host varchar(255),port integer,username varchar(255),password varchar(255),encryption varchar(50),notification_types json,created_at timestamp,updated_at timestamp)')
        connection.exec_driver_sql('CREATE TABLE notification_outbox (id varchar(36) primary key,status varchar(20),attempts integer,max_attempts integer,next_attempt_at timestamptz)')
        connection.exec_driver_sql("INSERT INTO smtp_config VALUES (1,'smtp.example.com',587,'synthetic@example.com','synthetic-only','tls')")
        connection.exec_driver_sql("INSERT INTO notification_outbox VALUES ('old-sending','SENDING',1,5,NULL),('old-failed','FAILED',5,5,NULL)")
        connection.exec_driver_sql('CREATE TABLE unrelated_data (id integer primary key, value text)')
        connection.exec_driver_sql("INSERT INTO unrelated_data VALUES (1,'preserve')")
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_reviewed_legacy_install_dry_run_apply_repeat_and_preserve_data(legacy):
    with legacy.begin() as connection:
        assert install(connection) == 'legacy_compatible'
        assert 'tenant_id' not in {item['name'] for item in inspect(connection).get_columns('smtp_config')}
        assert install(connection, apply=True) == 'applied'
        assert install(connection, apply=True) == 'already_compatible'
        row = connection.execute(text('SELECT tenant_id,is_enabled,password FROM smtp_config')).one()
        assert row.tenant_id is None and not row.is_enabled and row.password == 'synthetic-only'
        assert dict(connection.execute(text('SELECT id,delivery_state FROM notification_outbox')).all()) == {'old-sending': 'uncertain', 'old-failed': 'failed'}
        assert connection.scalar(text('SELECT value FROM unrelated_data')) == 'preserve'
        assert 'alembic_version' not in inspect(connection).get_table_names()


@pytest.mark.parametrize('unknown', ['partial', 'versioned'])
def test_legacy_install_refuses_partial_or_versioned_schema(legacy, unknown):
    with legacy.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE smtp_config ADD COLUMN provider varchar(40)' if unknown == 'partial' else 'CREATE TABLE alembic_version (version_num varchar(32) primary key)')
        with pytest.raises(RuntimeError):
            install(connection, apply=True)
        assert 'smtp_delivery_attempts' not in inspect(connection).get_table_names()


def test_legacy_install_refuses_missing_security_index_after_partial_install(legacy):
    with legacy.begin() as connection:
        install(connection, apply=True)
        connection.exec_driver_sql('DROP INDEX uq_smtp_tenant_name_ci')
        with pytest.raises(RuntimeError, match='indexes are incomplete'):
            install(connection, apply=True)
