"""Disposable real-API browser fixture. Never imports the deployment app/engine.

Run from the repository root with VEE_BOOTSTRAP_SCHEMA=false. All task/config
writes use a new workspace-local SQLite database; external delivery is disabled.
"""
import json
from pathlib import Path
import sys
from uuid import uuid4
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))

import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker
from fastapi import FastAPI, Depends
import uvicorn

from backend.app import models as m
from backend.app.auth import create_access_token
from backend.app.database import Base, get_db
from backend.app.dependencies import get_current_active_user
from backend.app.routers import tasks, task_statuses, kanban
from backend.app.services import task_statuses as statuses, audit_logger, task_events, notification_dispatcher
from backend.app.tickets import models as ticket_models  # noqa: F401

scratch=ROOT/'.tmp'/'status-live'
scratch.mkdir(parents=True,exist_ok=True)
(scratch/'.gitignore').write_text('*\n',encoding='utf-8')
engine=sa.create_engine('sqlite:///'+(scratch/(uuid4().hex+'.db')).as_posix(),connect_args={'check_same_thread':False,'timeout':30})
@sa.event.listens_for(engine,'connect')
def foreign_keys(connection,_):connection.execute('PRAGMA foreign_keys=ON')
computed=m.Task.__table__.c.search_vector.computed
m.Task.__table__.c.search_vector.computed=None
Base.metadata.create_all(engine)
m.Task.__table__.c.search_vector.computed=computed
factory=sessionmaker(bind=engine,expire_on_commit=False)

# Prevent Redis/push/automation delivery to any running local installation.
tasks.get_cached_json=lambda *args:None
tasks.set_cached_json=lambda *args,**kwargs:None
tasks.trigger_n8n_event=lambda *args,**kwargs:None
tasks._schedule_notification_outbox_delivery=lambda *args:None
tasks._invalidate_task_cache=lambda *args,**kwargs:None
statuses.invalidate=lambda *args:None
task_events.publish_task_event=lambda *args,**kwargs:None
audit_logger.log_event=lambda *args,**kwargs:None
notification_dispatcher.push_service.send_push=lambda *args,**kwargs:0

with factory() as db:
    owner=m.User(id=str(uuid4()),tenant_id=uuid4(),name='Live Guild Reviewer',email=f'{uuid4()}@example.com',hashed_password='fixture-only',role=m.RoleEnum.OWNER,status=m.UserStatusEnum.ACTIVE,points=125)
    foreign=m.User(id=str(uuid4()),tenant_id=uuid4(),name='Other tenant',email=f'{uuid4()}@example.com',hashed_password='fixture-only',role=m.RoleEnum.OWNER,status=m.UserStatusEnum.ACTIVE)
    db.add_all([owner,foreign]);db.flush()
    task=m.Task(id=str(uuid4()),title='Live status expedition',created_by_id=owner.id,assigned_to_id=owner.id,team='Engineering',due_at=datetime.utcnow()+timedelta(hours=2))
    db.add(task);statuses.scope(db,owner);db.commit()
    def token(user):return create_access_token(user.id,extra_claims={'tenant_id':str(user.tenant_id),'credentials_version':user.credentials_version})
    (scratch/'setup.json').write_text(json.dumps({'owner':owner.id,'tenant':str(owner.tenant_id),'token':token(owner),'foreign_token':token(foreign),'task':task.id}),encoding='utf-8')

app=FastAPI()
def database():
    with factory() as db:yield db
app.dependency_overrides[get_db]=database
for router in (tasks.router,task_statuses.router,kanban.router):app.include_router(router,prefix='/api')

@app.get('/__fixture/setup')
def setup():
    # Ephemeral fixture identities only; this server is bound to loopback and
    # this module is never mounted in the application.
    return json.loads((scratch/'setup.json').read_text(encoding='utf-8'))

@app.get('/__fixture/state')
def state(user=Depends(get_current_active_user),db=Depends(get_db)):
    assert user.id==owner.id
    account=db.get(m.User,owner.id)
    return {'points':account.points,'completed':account.tasks_completed,
            'history':db.scalar(sa.select(sa.func.count()).select_from(m.TaskLifecycleEvent).where(m.TaskLifecycleEvent.task_id==task.id)),
            'config_audits':db.scalar(sa.select(sa.func.count()).select_from(m.StatusConfigurationAudit).where(m.StatusConfigurationAudit.tenant_id==owner.tenant_id))}

if __name__=='__main__':
    try:uvicorn.run(app,host='127.0.0.1',port=6338,log_level='warning')
    finally:engine.dispose()
