"""Security and compatibility regressions found during the avatar review."""
# Pytest resolves imported fixtures by name.
# ruff: noqa: F811
from datetime import timedelta, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select

from backend.app import models, schemas
from backend.app.avatar_static import AvatarSafeStaticFiles
from backend.app.avatar_utils import (
    cleanup_unused_avatar,
    normalize_avatar,
    set_user_avatar_from_data_url,
)
from backend.app.routers.auth import get_me
from backend.app.storage.local import LocalAdapter
from backend.tests.test_avatar_profiles import headers, picture, setup  # noqa: F401
from backend.tests.test_task_lifecycle import data, engine  # noqa: F401


def test_sensitive_fields_are_absent_from_unauthorized_responses(setup, data):
    client, member, _ = setup
    with data.factory() as db:
        owner = db.get(models.User, data.owner.id)
        owner.phone, owner.location, owner.notes = 'private-phone', 'private-location', 'private-notes'
        owner.employer_id = 'PRIVATE-OWNER'
        other = db.get(models.User, member.id)
        other.phone, other.location, other.notes = 'member-phone', 'member-location', 'admin-only-notes'
        db.commit()
        assert get_me(other).model_dump()['phone'] == 'member-phone'
        assert 'notes' not in get_me(other).model_dump()
        nested = schemas.UserRead.model_validate(owner).model_dump()
        assert not {'phone', 'location', 'notes', 'profile_image_key'} & nested.keys()
    for path in [f'/api/users/{data.owner.id}', '/api/users/by-employer-id/PRIVATE-OWNER']:
        response = client.get(path, headers=headers(member))
        assert response.status_code == 200
        assert not {'phone', 'location', 'notes', 'profile_image_key'} & response.json().keys()
        assert 'private-' not in response.text
    listed = client.get('/api/users', headers=headers(member)).json()
    owner = next(item for item in listed if item['id'] == data.owner.id)
    own = next(item for item in listed if item['id'] == member.id)
    assert 'phone' not in owner and own['phone'] == 'member-phone' and 'notes' not in own
    permitted = client.get(f'/api/users/{member.id}', headers=headers(data.owner)).json()
    assert permitted['phone'] == 'member-phone' and permitted['notes'] == 'admin-only-notes'


def test_restricted_updates_and_existing_role_hierarchy(setup, data):
    client, member, _ = setup
    fields = {'department_id': None, 'employer_id': 'FORGED', 'manager_email': 'x@example.com',
              'shift_name': 'forged', 'shift_start': '00:00', 'shift_end': '23:59',
              'morning_break_start': '00:00', 'morning_break_end': '00:01',
              'lunch_break_start': '00:00', 'lunch_break_end': '00:01',
              'evening_break_start': '00:00', 'evening_break_end': '00:01'}
    for name, value in fields.items():
        assert client.patch('/api/users/me', headers=headers(member), json={name: value}).status_code == 403
    for name, value in {'role': 'owner', 'title': 'CEO', 'manager_id': data.owner.id, 'status': 'deactivated', 'points': 999, 'notes': 'forged'}.items():
        assert client.patch('/api/users/me', headers=headers(member), json={name: value}).status_code == 422
        assert client.patch(f'/api/users/{member.id}', headers=headers(member), json={name: value}).status_code == 403
    with data.factory() as db:
        people = {}
        for role in (models.RoleEnum.ADMIN, models.RoleEnum.MANAGER):
            person = models.User(id=str(uuid4()), tenant_id=member.tenant_id, name=role.value,
                                email=f'{uuid4()}@example.com', role=role, hashed_password='unused')
            db.add(person)
            people[role] = person
        db.commit()
    admin, manager = people[models.RoleEnum.ADMIN], people[models.RoleEnum.MANAGER]
    assert client.post(f'/api/users/{data.owner.id}/avatar', headers=headers(admin), json={'data_url': picture()}).status_code == 403
    assert client.patch(f'/api/users/{member.id}', headers=headers(manager), json={'avatar_frame': 'solar'}).status_code == 403
    assert client.patch(f'/api/users/{admin.id}', headers=headers(manager), json={'title': 'forged'}).status_code == 403
    assert client.patch(f'/api/users/{member.id}', headers=headers(manager), json={'title': 'Developer'}).status_code == 200
    assert client.patch(f'/api/users/{member.id}', headers=headers(data.outsider), json={'employer_id': 'forged'}).status_code == 404
    assert client.get('/api/users', headers=headers(data.outsider)).json()[0]['id'] == data.outsider.id


def test_private_static_case_paths_and_storage_containment(setup, tmp_path):
    client, _, adapter = setup
    for path in ('.avatars/secret.webp', '.AVATARS/secret.webp', 'avatars/custom/secret.webp', 'Avatars/Custom/secret.webp'):
        file = adapter.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b'private-image')
        assert client.get('/uploads/' + path).status_code == 404
    for path in ('avatars/x/%2e%2e/custom/secret.webp', '%2eavatars/secret.webp', 'avatars%5ccustom%5csecret.webp'):
        assert client.get('/uploads/' + path).status_code == 404
    outside = tmp_path / 'media-sibling' / 'secret.webp'
    outside.parent.mkdir()
    outside.write_bytes(b'keep')
    for operation in (adapter.read, adapter.delete):
        with pytest.raises(ValueError):
            operation('../media-sibling/secret.webp')
    assert outside.read_bytes() == b'keep'
    # A fresh adapter/process can read the same durable media root.
    adapter.save_private(b'persisted', '.avatars/durable.webp', content_type='image/webp')
    assert LocalAdapter(str(adapter.root), '/uploads').read('.avatars/durable.webp') == b'persisted'


def test_shipped_svg_avatars_remain_usable_but_uploaded_svg_is_rejected(setup, data):
    client, member, _ = setup
    with data.factory() as db:
        db.add(models.AvatarAsset(id='avatar-default-01', name='Shipped', is_default=True,
                                 file_path='avatars/library/default-avatar-01.svg', mime_type='image/svg+xml'))
        db.commit()
    client.app.mount('/assets', AvatarSafeStaticFiles(directory=str(Path(__file__).parents[1] / 'assets')))
    selected = client.patch('/api/users/me', headers=headers(member), json={'avatar_asset_id': 'avatar-default-01'})
    assert selected.status_code == 200
    assert selected.json()['avatar_url'] == '/assets/avatars/library/default-avatar-01.svg'
    assert client.get(selected.json()['avatar_url']).status_code == 200
    assert client.post('/api/avatars', headers=headers(data.owner), json={'name': 'Unsafe', 'data_url': 'data:image/svg+xml;base64,PHN2Zz4='}).status_code == 400
    assert client.patch('/api/avatars/avatar-default-01', headers=headers(data.owner), json={'name': 'forged'}).status_code == 403


def test_crop_edges_animation_metadata_and_polyglot_content():
    image = BytesIO()
    Image.new('RGB', (64, 64), 'red').save(image, 'PNG')
    for crop in ({'x': 64, 'y': 0, 'width': 1, 'height': 32}, {'x': 63.9, 'y': 0, 'width': 1, 'height': 32}):
        with pytest.raises(HTTPException) as error:
            normalize_avatar(image.getvalue(), 'image/png', crop)
        assert error.value.status_code == 400
    clean, _ = normalize_avatar(image.getvalue() + b'<script>alert(1)</script>', 'image/png')
    assert b'<script>' not in clean
    assert Image.open(BytesIO(clean)).format == 'WEBP'
    animation = BytesIO()
    Image.new('RGB', (64, 64), 'red').save(animation, 'WEBP', save_all=True,
        append_images=[Image.new('RGB', (64, 64), 'blue')], duration=100, loop=0)
    with pytest.raises(HTTPException):
        normalize_avatar(animation.getvalue(), 'image/webp')


def test_employee_writes_match_existing_database_column_limits():
    from backend.app.profile_validation import EMPLOYEE_FIELD_LIMITS
    for model in (schemas.UserCreate, schemas.UserUpdate, schemas.UserProfileUpdate):
        defaults = {'name': 'Test', 'email': 'person@example.com', 'password': 'synthetic-test'} if model is schemas.UserCreate else {}
        for name, limit in EMPLOYEE_FIELD_LIMITS.items():
            if name in model.model_fields:
                with pytest.raises(ValueError):
                    model.model_validate({**defaults, name: 'x' * (limit + 1)})


def test_savepoint_cleanup_and_outer_rollback_preserve_committed_photo(setup, data):
    client, member, adapter = setup
    original = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    with data.factory() as db:
        if db.get_bind().dialect.name == 'sqlite':
            # pysqlite's legacy transaction mode does not BEGIN for SELECTs.
            db.connection().exec_driver_sql('BEGIN')
        user = db.get(models.User, member.id)
        with db.begin_nested():
            set_user_avatar_from_data_url(db, user, data_url=picture(color='blue'), actor=user)
        db.rollback()
    assert client.get(f'/api/users/{member.id}', headers=headers(member)).json()['avatar_asset_id'] == original['avatar_asset_id']
    assert client.get(original['avatar_url'], headers=headers(member)).status_code == 200
    assert len(list(adapter.root.rglob('*.webp'))) == 2
    with data.factory() as db:
        user = db.get(models.User, member.id)
        set_user_avatar_from_data_url(db, user, data_url=picture(color='green'), actor=user)
        nested = db.begin_nested()
        set_user_avatar_from_data_url(db, user, data_url=picture(color='blue'), actor=user)
        nested.rollback()
        db.commit()
    assert len(list(adapter.root.rglob('*.webp'))) == 2


def test_deferred_cleanup_retries_and_does_not_delete_shared_images(setup, data, monkeypatch):
    client, member, adapter = setup
    original = client.post('/api/users/me/avatar', headers=headers(member), json={'data_url': picture()}).json()
    real_delete = adapter.delete
    monkeypatch.setattr(adapter, 'delete', lambda _: (_ for _ in ()).throw(OSError('offline')))
    assert client.patch('/api/users/me', headers=headers(member), json={'avatar_asset_id': None}).status_code == 200
    with data.factory() as db:
        assert db.get(models.AvatarAsset, original['avatar_asset_id']) is not None
    monkeypatch.setattr(adapter, 'delete', real_delete)
    with data.factory() as db:
        cleanup_unused_avatar(db, original['avatar_asset_id'])
        db.commit()
        assert db.get(models.AvatarAsset, original['avatar_asset_id']) is None
    assert not list(adapter.root.rglob('*.webp'))


def test_validation_and_timezone_conflict_token(setup):
    client, member, _ = setup
    auth = headers(member)
    before = client.get(f'/api/users/{member.id}', headers=auth).json()
    from datetime import datetime
    stamp = datetime.fromisoformat(before['updated_at']).replace(tzinfo=timezone.utc).astimezone(timezone(timedelta(hours=5, minutes=30)))
    assert client.patch('/api/users/me', headers=auth, json={'expected_updated_at': stamp.isoformat(), 'profile_bio': 'saved'}).status_code == 200
    for skills in (['x' * 61], [str(n) for n in range(31)], ['  ']):
        assert client.patch('/api/users/me', headers=auth, json={'skills': skills}).status_code == 422
    assert client.patch('/api/users/me', headers=auth, json={'avatar_frame': 'unsafe'}).status_code == 422
    for frame in ('classic', 'aurora', 'solar', 'emerald', 'role-ring', 'achievement-glow', 'minimal'):
        assert client.patch('/api/users/me', headers=auth, json={'avatar_frame': frame}).json()['avatar_frame'] == frame


def test_explicit_asset_tenant_overrides_legacy_creator_and_hides_raw_payload(setup, data):
    client, member, _ = setup
    with data.factory() as db:
        wrong = models.AvatarAsset(name='Different workspace', tenant_id=data.outsider.tenant_id,
            created_by_id=data.owner.id, is_default=True, data_url=picture())
        db.add(wrong)
        db.commit()
        wrong_id = wrong.id
    assert wrong_id not in [asset['id'] for asset in client.get('/api/avatars', headers=headers(data.owner)).json()]
    assert client.get(f'/api/avatars/{wrong_id}/image', headers=headers(member)).status_code == 404
    assert client.patch(f'/api/avatars/{wrong_id}', headers=headers(data.owner), json={'name': 'forged'}).status_code == 404
    assert client.delete(f'/api/avatars/{wrong_id}', headers=headers(data.owner)).status_code == 404
    assert 'data_url' not in client.get('/api/avatars', headers=headers(data.outsider)).json()[0]


def test_legacy_foreign_avatar_reference_cannot_leak_url_or_metadata(setup, data):
    client, member, _ = setup
    with data.factory() as db:
        asset = models.AvatarAsset(name='Secret foreign metadata', tenant_id=data.outsider.tenant_id,
            created_by_id=data.outsider.id, is_default=False, external_url='https://private.example.com/foreign.png')
        db.add(asset)
        db.flush()
        owner = db.get(models.User, data.owner.id)
        owner.avatar_asset_id = asset.id
        owner.phone = 'private-phone'
        db.commit()
        authorized = schemas.UserRead.for_viewer(owner, owner)
        assert authorized.model_dump()['phone'] == 'private-phone'
        assert 'phone' not in schemas.UserRead.for_viewer(authorized, member).model_dump()
        assert authorized.model_dump()['phone'] == 'private-phone'
    response = client.get(f'/api/users/{data.owner.id}', headers=headers(member))
    assert response.status_code == 200
    assert response.json()['avatar_asset'] is None
    assert response.json()['avatar_url'] is None and response.json()['profile_image_url'] is None
    assert 'Secret foreign' not in response.text and 'private.example.com' not in response.text


def test_migration_recovers_single_tenant_orphan_without_rewriting_users(engine, data):
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text
    with data.factory() as db:
        asset = models.AvatarAsset(name='Existing orphan', file_path='avatars/custom/old.png', is_default=False)
        db.add(asset)
        db.flush()
        db.get(models.User, data.owner.id).avatar_asset_id = asset.id
        db.commit()
        asset_id = asset.id
    with engine.begin() as connection:
        connection.execute(text('DROP INDEX ix_avatar_assets_tenant_id'))
        for name in ('tenant_id', 'storage_provider', 'thumbnail_path'):
            connection.execute(text(f'ALTER TABLE avatar_assets DROP COLUMN {name}'))
        connection.execute(text('ALTER TABLE users DROP COLUMN profile_bio'))
        with Operations.context(MigrationContext.configure(connection)):
            import_module('backend.alembic.versions.ffe4b5c6d7e8_employee_avatar_profile').upgrade()
        row = connection.execute(select(models.AvatarAsset.tenant_id).where(models.AvatarAsset.id == asset_id)).scalar_one()
        assert str(row) == str(data.owner.tenant_id)
        assert connection.execute(select(models.User.avatar_asset_id).where(models.User.id == data.owner.id)).scalar_one() == asset_id


def test_cloud_adapters_fail_closed_for_public_or_unknown_permissions():
    from backend.app.storage.gdrive import GoogleDriveAdapter
    from backend.app.storage.supabase import SupabaseAdapter
    uploaded = []
    bucket = {}
    api = SimpleNamespace(upload=lambda **kwargs: uploaded.append(kwargs), download=lambda _: b'private-image')
    supabase = SupabaseAdapter('https://fixture.invalid', 'private', service_role_key='synthetic-test-key')
    supabase._client = SimpleNamespace(storage=SimpleNamespace(get_bucket=lambda _: bucket, from_=lambda _: api))
    for public in (None, True):
        bucket['public'] = public
        with pytest.raises(ValueError):
            supabase.save_private(b'image', '.avatars/tenant/asset.webp', content_type='image/webp')
    bucket['public'] = False
    supabase.save_private(b'image', '.avatars/tenant/asset.webp', content_type='image/webp')
    assert len(uploaded) == 1 and uploaded[0]['file_options']['upsert'] == 'false'
    assert supabase.read('.avatars/tenant/asset.webp') == b'private-image'

    pages = [{'permissions': [{'type': 'user'}], 'nextPageToken': 'next'}, {'permissions': [{'type': 'domain'}]}]
    calls = []
    def listing(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(execute=lambda: pages.pop(0))
    drive = GoogleDriveAdapter(parent_folder_id='fixture-private-folder')
    drive._service = SimpleNamespace(permissions=lambda: SimpleNamespace(list=listing))
    with pytest.raises(ValueError):
        drive.save_private(b'image', '.avatars/tenant/asset.webp', content_type='image/webp')
    assert calls[1]['pageToken'] == 'next'


def test_concurrent_replacements_honor_version_and_keep_one_complete_photo(setup, data, engine):
    if engine.dialect.name != 'postgresql':
        pytest.skip('Row-lock concurrency contract uses PostgreSQL')
    from concurrent.futures import ThreadPoolExecutor
    client, member, adapter = setup
    auth = headers(member)
    original = client.get(f'/api/users/{member.id}', headers=auth).json()
    def replace(color):
        return client.post('/api/users/me/avatar', headers=auth, json={
            'data_url': picture(color=color), 'expected_updated_at': original['updated_at']}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(replace, ['green', 'blue']))
    assert outcomes == [200, 409]
    saved = client.get(f'/api/users/{member.id}', headers=auth).json()
    assert client.get(saved['avatar_url'], headers=auth).status_code == 200
    assert len(list(adapter.root.rglob('*.webp'))) == 2


def test_legacy_finalize_uses_canonical_pipeline_and_retryable_original_cleanup(setup, data, monkeypatch):
    import base64

    from backend.app.config import get_settings
    from backend.app.services import minio_media_service
    from backend.app.storage import minio
    client, member, _ = setup
    deleted = []
    outage = True
    def remove(**kwargs):
        if outage:
            raise OSError('simulated provider outage')
        deleted.append(kwargs['Key'])
    store = SimpleNamespace(get_object=lambda **kw: {'Body': BytesIO(base64.b64decode(picture().split(',')[1]))}, delete_object=remove)
    monkeypatch.setattr(minio_media_service, '_get_minio_client', lambda: store)
    monkeypatch.setattr(minio, 'get_minio_client', lambda: store)
    key = f'avatars/{member.id}/original.png'
    with data.factory() as db:
        upload = models.MediaFile(user_id=member.id, bucket=get_settings().minio_bucket_attachments,
            object_key=key, original_filename='original.png', content_type='image/png', size_bytes=100,
            media_type=models.MediaFileTypeEnum.AVATAR, status=models.MediaFileStatusEnum.CONFIRMED)
        db.add(upload)
        db.commit()
        user = db.get(models.User, member.id)
        result, _, url = minio_media_service.finalize_avatar_upload(db, user=user, file_id=upload.id, crop_metadata={})
        assert result.deleted_at is not None and user.profile_image_key is None
        retirement = db.scalar(select(models.AvatarAsset).where(models.AvatarAsset.storage_provider == 'legacy-minio'))
        assert retirement is not None
        retirement_id = retirement.id
    assert client.get(url, headers=headers(member)).status_code == 200
    outage = False
    with data.factory() as db:
        cleanup_unused_avatar(db, retirement_id)
        db.commit()
    assert deleted == [key]
