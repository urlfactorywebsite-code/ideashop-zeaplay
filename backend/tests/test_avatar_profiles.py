# Imported pytest fixtures are resolved by name in test signatures.
# ruff: noqa: F811
"""Avatar/profile contracts, real HTTP authentication and disposable databases only."""
import base64
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import models
from backend.app.auth import create_access_token
from backend.app.avatar_static import AvatarSafeStaticFiles
from backend.app.avatar_utils import normalize_avatar, set_user_avatar_from_data_url
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.routers import avatars, users
from backend.app.services import media_service
from backend.app.storage.local import LocalAdapter
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401


def picture(fmt='PNG', size=(120, 80), color='red'):
    output = BytesIO()
    image = Image.new('RGB', size, color)
    image.save(output, fmt)
    return f'data:image/{"jpeg" if fmt == "JPEG" else fmt.lower()};base64,' + base64.b64encode(output.getvalue()).decode()


def headers(user):
    return {'Authorization': 'Bearer ' + create_access_token(user.id, extra_claims={
        'tenant_id': str(user.tenant_id), 'credentials_version': user.credentials_version})}


@pytest.fixture
def setup(data, tmp_path, monkeypatch):
    adapter = LocalAdapter(str(tmp_path / 'media'), '/uploads')
    monkeypatch.setattr(media_service, 'get_default_adapter', lambda: adapter)
    monkeypatch.setattr(media_service, 'get_adapter', lambda _: adapter)
    monkeypatch.setattr(users.audit_logger, 'log_event', lambda *a, **kw: None)
    monkeypatch.setattr(users, 'trigger_n8n_event', lambda *a, **kw: None)
    with data.factory() as db:
        member = models.User(id=str(uuid4()), tenant_id=data.owner.tenant_id, name='Alice Example',
            email=f'{uuid4()}@example.com', role=models.RoleEnum.USER, hashed_password='unused')
        db.add(member)
        for person in (data.owner, data.outsider):
            db.get(models.User, person.id).email = f'{uuid4()}@example.com'
        db.commit()
    app = FastAPI()
    app.include_router(users.router, prefix='/api')
    app.include_router(avatars.router, prefix='/api')
    app.mount('/uploads', AvatarSafeStaticFiles(directory=str(adapter.root)))
    def database():
        with data.factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client, member, adapter


def test_upload_crop_refresh_replace_remove_and_frames(setup, data):
    client, member, adapter = setup
    auth = headers(member)
    first = client.post('/api/users/me/avatar', headers=auth, json={'data_url': picture(), 'crop': {'x': 20, 'y': 0, 'width': 80, 'height': 80}})
    assert first.status_code == 200, first.text
    body = first.json()
    asset_id = body['avatar_asset_id']
    url = body['avatar_url']
    image = client.get(url, headers=auth)
    assert image.status_code == 200
    assert image.headers['cache-control'] == 'private, no-store'
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (512, 512) and decoded.format == 'WEBP'
        assert not decoded.getexif()
    thumb = client.get(url + '&size=128', headers=auth)
    assert Image.open(BytesIO(thumb.content)).size == (128, 128)
    assert client.get(f'/api/users/{member.id}', headers=auth).json()['avatar_url'] == url
    frame = client.patch('/api/users/me', headers=auth, json={'avatar_frame': 'aurora'})
    assert frame.status_code == 200 and frame.json()['avatar_asset_id'] == asset_id
    replacement = client.post('/api/users/me/avatar', headers=auth, json={'data_url': picture('JPEG', color='blue')})
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()['avatar_url'] != url
    assert replacement.json()['avatar_frame'] == 'aurora'
    assert client.get(url, headers=auth).status_code == 404
    assert len(list(adapter.root.rglob('*.webp'))) == 2
    removed = client.patch('/api/users/me', headers=auth, json={'avatar_asset_id': None})
    assert removed.status_code == 200 and removed.json()['avatar_url'] is None
    assert removed.json()['profile_image_url'] is None
    assert removed.json()['avatar_frame'] == 'aurora'
    assert not list(adapter.root.rglob('*.webp'))


@pytest.mark.parametrize('bad', [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,aGVsbG8=',
    'data:image/png;base64,!!!!',
    picture('JPEG').replace('image/jpeg', 'image/png'),
    picture(size=(16, 16)),
])
def test_reject_bad_images(setup, bad):
    client, member, adapter = setup
    result = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': bad})
    assert result.status_code == 400, result.text
    assert not list(adapter.root.rglob('*.webp'))


def test_limits_crop_and_dimensions(setup, monkeypatch):
    client, member, _ = setup
    monkeypatch.setattr(get_settings(), 'avatar_max_file_size_mb', 1)
    payload = 'data:image/png;base64,' + base64.b64encode(b'x' * (1024 * 1024 + 1)).decode()
    assert client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': payload}).status_code == 413
    assert client.get('/api/avatars/limits', headers=headers(member)).json()['max_bytes'] == 1024 * 1024
    assert client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture(), 'crop': {'x': 300, 'y': 0, 'width': 10, 'height': 10}}).status_code == 400
    monkeypatch.setattr(get_settings(), 'avatar_max_pixels', 1024)
    assert client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).status_code == 400


def test_tenant_authorization_and_private_static(setup, data):
    client, member, _ = setup
    own = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    assert client.get(own['avatar_url']).status_code == 401
    assert client.get(own['avatar_url'], headers=headers(data.outsider)).status_code == 404
    assert client.get(f'/api/users/{member.id}', headers=headers(data.outsider)).status_code == 404
    assert client.post(f'/api/users/{member.id}/avatar', headers=headers(data.outsider), json={'data_url': picture()}).status_code == 404
    assert client.post(f'/api/users/{data.owner.id}/avatar', headers=headers(member), json={'data_url': picture()}).status_code == 403
    assert client.patch('/api/users/me', headers=headers(data.outsider), json={'avatar_asset_id': own['avatar_asset_id']}).status_code == 404
    assert own['avatar_asset_id'] not in [a['id'] for a in client.get('/api/avatars', headers=headers(data.outsider)).json()]
    with data.factory() as db:
        path = db.get(models.AvatarAsset, own['avatar_asset_id']).file_path
    assert client.get('/uploads/' + path).status_code == 404
    assert client.post(f'/api/users/{member.id}/avatar', headers=headers(data.owner), json={'data_url': picture()}).status_code == 200


def test_bio_skills_contact_and_forbidden_fields(setup, data):
    client, member, _ = setup
    auth = headers(member)
    changed = client.patch('/api/users/me', headers=auth, json={'profile_bio': '<script>no()</script>\nSecond line', 'skills': [' Python ', 'python', 'React'], 'phone': '123', 'location': 'Remote', 'timezone': 'Asia/Kolkata'})
    assert changed.status_code == 200, changed.text
    assert changed.json()['skills'] == ['Python', 'React']
    assert changed.json()['profile_bio'].endswith('\nSecond line')
    refreshed = client.get(f'/api/users/{member.id}', headers=auth).json()
    assert refreshed['phone'] == '123' and refreshed['location'] == 'Remote'
    assert client.patch('/api/users/me', headers=auth, json={'profile_bio': 'x' * 501}).status_code == 422
    assert client.patch('/api/users/me', headers=auth, json={'timezone': 'invalid'}).status_code == 422
    assert client.patch('/api/users/me', headers=auth, json={'role': 'owner'}).status_code == 422
    for field in ('department_id', 'employer_id', 'manager_email'):
        assert client.patch('/api/users/me', headers=auth, json={field: 'forbidden'}).status_code in (400, 403)
    assert client.patch(f'/api/users/{member.id}', headers=auth, json={'role': 'owner'}).status_code == 403
    assert client.patch('/api/users/me', headers=auth, json={'skills': []}).json()['skills'] == []
    assert client.patch('/api/users/me', headers=auth, json={'profile_bio': 'stale', 'expected_updated_at': changed.json()['updated_at']}).status_code == 409
    assert client.patch(f'/api/users/{member.id}', headers=headers(data.owner), json={'manager_id': data.outsider.id}).status_code == 400


def test_rollback_preserves_old_avatar(setup, data):
    client, member, adapter = setup
    original = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    with data.factory() as db:
        target = db.get(models.User, member.id)
        set_user_avatar_from_data_url(db, target, data_url=picture(color='blue'), actor=target)
        db.rollback()
    assert client.get(original['avatar_url'], headers=headers(member)).status_code == 200
    assert len(list(adapter.root.rglob('*.webp'))) == 2


def test_abandoned_session_cleans_uncommitted_variants(setup, data):
    _, member, adapter = setup
    with data.factory() as db:
        user = db.get(models.User, member.id)
        set_user_avatar_from_data_url(db, user, data_url=picture(), actor=user)
        assert len(list(adapter.root.rglob('*.webp'))) == 2
    assert not list(adapter.root.rglob('*.webp'))


def test_metadata_and_truncated_integrity():
    data = BytesIO()
    exif = Image.Exif(); exif[270] = 'private metadata'
    Image.new('RGB', (64, 64)).save(data, 'JPEG', exif=exif)
    output, _ = normalize_avatar(data.getvalue(), 'image/jpeg')
    assert not Image.open(BytesIO(output)).getexif()
    with pytest.raises(HTTPException):
        normalize_avatar(data.getvalue()[:50], 'image/jpeg')


def test_shared_avatar_is_not_deleted_and_library_replacement_is_atomic(setup, data):
    client, member, adapter = setup
    own = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    selected = client.patch('/api/users/me', headers=headers(data.owner), json={'avatar_asset_id': own['avatar_asset_id']})
    assert selected.status_code == 200
    client.patch('/api/users/me', headers=headers(member), json={'avatar_asset_id': None})
    assert client.get(own['avatar_url'], headers=headers(data.owner)).status_code == 200
    assert len(list(adapter.root.rglob('*.webp'))) == 2
    library = client.post('/api/avatars', headers=headers(data.owner), json={'name': 'Library', 'storage_type': 'data_url', 'data_url': picture()})
    assert library.status_code == 201, library.text
    original = library.json()
    changed = client.patch('/api/avatars/' + original['id'], headers=headers(data.owner), json={'data_url': picture(color='blue')})
    assert changed.status_code == 200, changed.text
    assert changed.json()['id'] == original['id'] and changed.json()['url'] != original['url']


def test_migration_preserves_existing_data(engine):
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect, text
    migration = import_module('backend.alembic.versions.ffe4b5c6d7e8_employee_avatar_profile')
    with engine.begin() as connection:
        connection.execute(text('DROP INDEX ix_avatar_assets_tenant_id'))
        for name in ('tenant_id', 'storage_provider', 'thumbnail_path'):
            connection.execute(text(f'ALTER TABLE avatar_assets DROP COLUMN {name}'))
        connection.execute(text('ALTER TABLE users DROP COLUMN profile_bio'))
        connection.execute(text("INSERT INTO avatar_assets (id,name,storage_type,is_default,created_at,updated_at) VALUES ('legacy','Legacy avatar','FILE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert connection.execute(text("SELECT name FROM avatar_assets WHERE id='legacy'")).scalar() == 'Legacy avatar'
        assert {'tenant_id', 'storage_provider', 'thumbnail_path'} <= {col['name'] for col in inspect(connection).get_columns('avatar_assets')}
        assert 'profile_bio' in {col['name'] for col in inspect(connection).get_columns('users')}


def test_authenticated_model_serialization_does_not_require_route_hydration(setup, data):
    from backend.app.schemas import UserRead
    client, member, _ = setup
    saved = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    with data.factory() as db:
        reloaded = UserRead.model_validate(db.get(models.User, member.id)).model_dump()
    assert reloaded['avatar_url'] == saved['avatar_url']
    assert reloaded['profile_image_url'] == saved['avatar_url']
    assert reloaded['avatar_asset']['url'] == saved['avatar_url']


def test_failed_storage_write_preserves_previous_picture(setup, monkeypatch):
    client, member, adapter = setup
    original = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    original_save = adapter.save_private
    calls = 0

    def fail_thumbnail(contents, path, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError('Simulated storage outage')
        return original_save(contents, path, **kwargs)

    monkeypatch.setattr(adapter, 'save_private', fail_thumbnail)
    response = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture(color='blue')})
    assert response.status_code == 503
    assert client.get(original['avatar_url'], headers=headers(member)).status_code == 200
    assert len(list(adapter.root.rglob('*.webp'))) == 2


def test_admin_employment_save_and_stale_avatar_conflict(setup, data):
    client, member, _ = setup
    before = client.get(f'/api/users/{member.id}', headers=headers(member)).json()
    changed = client.patch(f'/api/users/{member.id}', headers=headers(data.owner), json={
        'title': 'Software Engineer', 'employer_id': 'EMP-042', 'manager_id': data.owner.id,
        'expected_updated_at': before['updated_at'], 'skills': ['FastAPI', 'fastapi']})
    assert changed.status_code == 200, changed.text
    assert changed.json()['title'] == 'Software Engineer'
    assert changed.json()['employer_id'] == 'EMP-042'
    assert changed.json()['manager_id'] == data.owner.id
    assert changed.json()['skills'] == ['FastAPI']
    assert client.post('/api/users/me/avatar', headers=headers(member), json={
        'data_url': picture(), 'expected_updated_at': before['updated_at']}).status_code == 409
