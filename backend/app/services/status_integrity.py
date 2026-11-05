"""Read-only status schema/data checks; never provision or repair production data."""
from collections import Counter, defaultdict
import math

import sqlalchemy as sa

from .. import models as m
from .task_statuses import BLUEPRINT, system_behavior, normalize

REQUIRED_INDEXES = {
    'tasks': {'ix_tasks_status_custom_updated_id'},
    'task_hold_intervals': {'uq_task_hold_open','ix_task_hold_task_started_id'},
    'status_configuration_audits': {'ix_status_audit_tenant_created_id'},
}
INDEX_COLUMNS = {
    'ix_tasks_status_custom_updated_id':['status','custom_status_id','updated_at','id'],
    'uq_task_hold_open':['task_id'],
    'ix_task_hold_task_started_id':['task_id','started_at','id'],
    'ix_status_audit_tenant_created_id':['tenant_id','created_at','id'],
}
PG_GUARDS = {'zea_protect_task_status','zea_status_no_truncate','zea_status_audit_immutable',
    'zea_validate_task_custom_status','zea_behavior_guard','zea_kanban_system_visible',
    'zea_hold_capture','zea_hold_ledger_guard','zea_hold_no_truncate','zea_custom_status_history'}
SQLITE_GUARDS = {'zea_status_identity','zea_status_system_delete','zea_status_system_update','zea_status_archive',
    'zea_status_referenced_delete','zea_status_audit_immutable_update','zea_status_audit_immutable_delete',
    'zea_behavior_guard_insert','zea_behavior_guard_update','zea_behavior_change',
    'zea_behavior_assignment_insert','zea_behavior_assignment_update','zea_behavior_canonical',
    'zea_kanban_system_visible_insert','zea_kanban_system_visible_update',
    'zea_hold_enter_insert','zea_hold_enter_update','zea_hold_exit','zea_hold_deleted',
    'zea_hold_immutable_update','zea_hold_immutable_delete','zea_hold_overlap','zea_hold_tenant',
    'zea_custom_status_history_insert','zea_custom_status_history_update'}


def schema_issues(connection):
    inspector=sa.inspect(connection)
    tables=set(inspector.get_table_names())
    issues=[]
    for table,names in REQUIRED_INDEXES.items():
        if table not in tables:
            issues.append('missing_table:'+table);continue
        found={item['name']:item for item in inspector.get_indexes(table)}
        issues.extend('missing_index:'+name for name in sorted(names-found.keys()))
        for name in sorted(names & found.keys()):
            if found[name]['column_names']!=INDEX_COLUMNS[name]:issues.append('index_definition:'+name)
            if name=='uq_task_hold_open':
                predicate=str(found[name].get('dialect_options',{}).get(connection.dialect.name+'_where','')).lower().replace('(','').replace(')','').strip()
                if not found[name]['unique'] or predicate!='ended_at is null':issues.append('index_definition:'+name)
    for table,required in {
        'task_status_scopes':{'tenant_id','revision','hold_reason_required'},
        'task_statuses':{'workflow_behavior','kanban_visible','legacy_status'},
        'tasks':{'custom_status_id','hold_started_at','hold_paused_seconds','hold_previous_status','hold_reason',
                 'status_transitioned_at','status_transition_version'},
    }.items():
        if table not in tables:
            issues.append('missing_table:'+table);continue
        found={item['name'] for item in inspector.get_columns(table)}
        issues.extend('missing_column:'+table+'.'+name for name in sorted(required-found))
    if connection.dialect.name=='postgresql':
        invalid=set(connection.scalars(sa.text("""SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND NOT (i.indisvalid AND i.indisready)""")))
        issues.extend('invalid_index:'+name for name in sorted(invalid & INDEX_COLUMNS.keys()))
        enabled=set(connection.scalars(sa.text("""SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()
            AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')""")))
        issues.extend('missing_guard:'+name for name in sorted(PG_GUARDS-enabled))
        pairs=set(connection.scalars(sa.text("""SELECT c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')""")))
        required={f'{table}.zea_lifecycle_{table}{suffix}' for table in ('tasks','subtasks','time_entries') for suffix in ('','_delete')}
        required.update(f'{table}.zea_lifecycle_immutable' for table in ('task_lifecycle_events','task_lifecycle_coverage'))
        issues.extend('missing_guard:'+name for name in sorted(required-pairs))
    elif connection.dialect.name=='sqlite':
        enabled=set(connection.scalars(sa.text("SELECT name FROM sqlite_master WHERE type='trigger'")))
        issues.extend('missing_guard:'+name for name in sorted(SQLITE_GUARDS-enabled))
        required={f'zea_lifecycle_{table}_{operation}' for table in ('tasks','subtasks','time_entries') for operation in ('insert','update','delete')}
        required.update(f'zea_lifecycle_immutable_{table}_{operation}' for table in ('task_lifecycle_events','task_lifecycle_coverage') for operation in ('update','delete'))
        issues.extend('missing_guard:'+name for name in sorted(required-enabled))
    else:
        issues.append('unsupported_database')
    return sorted(set(issues))


def audit_data(connection):
    errors=Counter();warnings=Counter()
    statuses={row['id']:row for row in connection.execute(sa.select(m.TaskStatus.__table__)).mappings()}
    by_tenant=defaultdict(list)
    for row in statuses.values():by_tenant[row['tenant_id']].append(row)
    scopes=set(connection.scalars(sa.select(m.TaskStatusScope.tenant_id)))
    errors['orphan_status_scope']=sum(1 for row in statuses.values() if row['tenant_id'] not in scopes)
    expected={(code,name,legacy,system_behavior(legacy)) for legacy,code,name in BLUEPRINT}
    for tenant in scopes:
        rows=by_tenant[tenant]
        actual={(row['code'],row['system_name'],row['legacy_status'],row['workflow_behavior']) for row in rows if row['is_system']}
        if actual!=expected:errors['system_identity_set']+=1
        tokens={}
        for row in rows:
            if row['is_system'] and (not row['is_active'] or not row['kanban_visible']):errors['system_disabled_or_hidden']+=1
            if not row['is_system'] and row['workflow_behavior'] not in ('ACTIVE','PENDING','HOLD'):errors['custom_behavior']+=1
            if row['normalized_name']!=normalize(row['system_name']) or row['normalized_label']!=normalize(row['display_label']):errors['normalization']+=1
            for name in ('system_name','display_label','code','legacy_status'):
                if not row[name]:continue
                token=normalize(row[name])
                if token in tokens and tokens[token]!=row['id']:errors['ambiguous_status_value']+=1
                tokens[token]=row['id']
    t=m.Task.__table__;h=m.TaskHoldInterval.__table__;u=m.User.__table__;p=m.Project.__table__
    assignee=u.alias('status_assignee')
    seconds=(sa.func.extract('epoch',h.c.ended_at-h.c.started_at) if connection.dialect.name=='postgresql'
             else (sa.func.julianday(h.c.ended_at)-sa.func.julianday(h.c.started_at))*86400.0)
    aggregate=sa.select(h.c.task_id,
        sa.func.sum(sa.case((h.c.ended_at.is_(None),1),else_=0)).label('open_count'),
        sa.func.min(sa.case((h.c.ended_at.is_(None),h.c.started_at))).label('open_start'),
        sa.func.sum(sa.case((h.c.ended_at.is_not(None),seconds),else_=0)).label('closed_seconds')
    ).group_by(h.c.task_id).subquery()
    tenant=sa.case((t.c.project_id.is_not(None),p.c.tenant_id),else_=u.c.tenant_id)
    statement=sa.select(t.c.id,sa.cast(t.c.status,sa.String).label('status'),t.c.custom_status_id,
        t.c.hold_started_at,t.c.hold_paused_seconds,t.c.completed_at,t.c.completion_xp_awarded_at,
        t.c.completion_xp_points_awarded,tenant.label('tenant'),assignee.c.tenant_id.label('assignee_tenant'),
        aggregate.c.open_count,aggregate.c.open_start,aggregate.c.closed_seconds).select_from(
            t.outerjoin(p,t.c.project_id==p.c.id).outerjoin(u,t.c.created_by_id==u.c.id)
             .outerjoin(assignee,t.c.assigned_to_id==assignee.c.id).outerjoin(aggregate,t.c.id==aggregate.c.task_id))
    task_count=0
    for row in connection.execute(statement.execution_options(stream_results=True)).mappings():
        task_count+=1
        if row['tenant'] is None:errors['task_ownership']+=1
        elif row['tenant'] not in scopes:errors['missing_task_workflow']+=1
        if row['assignee_tenant'] is not None and row['assignee_tenant']!=row['tenant']:errors['foreign_assignee']+=1
        if row['status'] not in {state.value for state in m.TaskStatusEnum}:errors['unmapped_task_status']+=1
        if row['custom_status_id']:
            status=statuses.get(row['custom_status_id'])
            if not status or status['tenant_id']!=row['tenant'] or status['is_system'] or not status['is_active']:
                errors['custom_task_reference']+=1
            elif row['status']!={'ACTIVE':'IN_PROGRESS','PENDING':'WAITING_FOR_REQUIREMENT','HOLD':'ON_HOLD'}.get(status['workflow_behavior']):
                errors['custom_native_mapping']+=1
        if (row['open_count'] or 0)!=int(row['status']=='ON_HOLD') or row['hold_started_at']!=row['open_start']:
            errors['open_hold_summary']+=1
        if not math.isfinite(row['hold_paused_seconds']) or row['hold_paused_seconds']<0 or abs(row['hold_paused_seconds']-(row['closed_seconds'] or 0))>.01:
            errors['closed_hold_summary']+=1
        if row['completion_xp_awarded_at'] is None and row['completion_xp_points_awarded'] is not None:
            errors['award_marker']+=1
        if (row['status'] in ('DONE','DEPLOYED'))!=(row['completed_at'] is not None):
            warnings['legacy_completion_timestamp']+=1
    # Retained history may outlive its task; an open orphan must never remain.
    errors['open_orphan_hold']=connection.scalar(sa.select(sa.func.count()).select_from(h.outerjoin(t,h.c.task_id==t.c.id))
        .where(t.c.id.is_(None),h.c.ended_at.is_(None))) or 0
    errors['hold_tenant']=connection.scalar(sa.select(sa.func.count()).select_from(
        h.join(t,h.c.task_id==t.c.id).outerjoin(p,t.c.project_id==p.c.id).outerjoin(u,t.c.created_by_id==u.c.id))
        .where(h.c.tenant_id!=tenant)) or 0
    other=h.alias('other_hold')
    errors['overlapping_holds']=connection.scalar(sa.select(sa.func.count()).select_from(h.join(other,
        sa.and_(h.c.task_id==other.c.task_id,h.c.id<other.c.id,
            sa.or_(other.c.ended_at.is_(None),h.c.started_at<other.c.ended_at),
            sa.or_(h.c.ended_at.is_(None),other.c.started_at<h.c.ended_at))))) or 0
    return {'tasks_checked':task_count,'scopes_checked':len(scopes),
            'errors':{key:count for key,count in sorted(errors.items()) if count},
            'warnings':dict(sorted(warnings.items()))}
