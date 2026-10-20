"""Real Alembic CLI on a uniquely owned schema in the disposable test database."""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def test_real_smtp_migration_preserves_legacy_data_quarantines_and_refuses_unsafe_downgrade():
    raw = os.environ.get('ZEAPLAY_RT_POSTGRES_TEST_URL')
    if not raw: pytest.skip('Explicit disposable PostgreSQL rt3_test database required')
    url = make_url(raw)
    assert 'rt3_test' in url.database
    schema = 'smtp_migration_' + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn: conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = url.update_query_dict({'options': f'-csearch_path={schema},public'})
    engine = create_engine(scoped)
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql('CREATE TABLE smtp_config (id integer primary key, host varchar(255), port integer, username varchar(255), password varchar(255), encryption varchar(50))')
            conn.exec_driver_sql('CREATE TABLE multiple_smtp_configs (id varchar(36) primary key, name varchar(255), host varchar(255), port integer, username varchar(255), password varchar(255), encryption varchar(50), notification_types json, created_at timestamp, updated_at timestamp)')
            conn.exec_driver_sql('CREATE TABLE notification_outbox (id varchar(36) primary key, status varchar(20), attempts integer, max_attempts integer, next_attempt_at timestamptz)')
            conn.exec_driver_sql("INSERT INTO smtp_config VALUES (1, 'smtp.example.com', 587, 'synthetic@example.com', 'synthetic-only', 'tls')")
            conn.exec_driver_sql("INSERT INTO notification_outbox VALUES ('a','SENDING',1,5,NULL),('b','SENT',1,5,NULL),('c','FAILED',1,5,NOW()),('d','FAILED',5,5,NULL)")
        env = {**os.environ, 'VEE_BOOTSTRAP_SCHEMA': 'false', 'VEE_DATABASE_URL': scoped.render_as_string(hide_password=False)}
        backend = Path(__file__).resolve().parents[1]
        def cli(*arguments):
            return subprocess.run([sys.executable, '-m', 'alembic', *arguments], cwd=backend, env=env, capture_output=True, text=True, timeout=60)
        assert cli('stamp', 'fe6f7a8b9c0d').returncode == 0
        result = cli('upgrade', 'ff7a8b9c0d1e')
        assert result.returncode == 0, result.stderr
        with engine.begin() as conn:
            row = conn.execute(text('SELECT tenant_id, is_enabled, password FROM smtp_config')).one()
            assert row.tenant_id is None and row.is_enabled is False and row.password == 'synthetic-only'
            states = dict(conn.execute(text('SELECT id, delivery_state FROM notification_outbox')).all())
            assert states == {'a': 'uncertain', 'b': 'sent', 'c': 'retrying', 'd': 'failed'}
            conn.execute(text("UPDATE smtp_config SET password='smtp:v1:synthetic-envelope'"))
        result = cli('downgrade', 'fe6f7a8b9c0d')
        assert result.returncode != 0 and 'downgrade is unsafe' in result.stderr
        with engine.connect() as conn:
            assert conn.scalar(text('SELECT version_num FROM alembic_version')) == 'ff7a8b9c0d1e'
    finally:
        engine.dispose()
        with admin.begin() as conn: conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
