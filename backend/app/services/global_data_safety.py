"""Fail closed around legacy operations that have no tenant-aware implementation."""
from fastapi import HTTPException
from sqlalchemy import String, cast, func, inspect, select

from ..config import get_settings
from ..database import Base


def ensure_single_tenant_installation(db, user):
    if str(user.tenant_id) != str(get_settings().default_tenant_id):
        raise HTTPException(403, 'Global data operations are restricted to the installation workspace.')
    present = set(inspect(db.get_bind()).get_table_names())
    for table in Base.metadata.tables.values():
        if table.name not in present or 'tenant_id' not in table.c:
            continue
        foreign = db.scalar(select(1).select_from(table).where(
            table.c.tenant_id.is_not(None),
            func.replace(cast(table.c.tenant_id, String), '-', '') != str(user.tenant_id).replace('-', ''),
        ).limit(1))
        if foreign:
            raise HTTPException(403, 'Legacy global backup, import, reset and retention settings are unavailable in a multi-tenant installation. Use reviewed host-level administration.')
