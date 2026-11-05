// Actual board, details, settings and HTTP adapters; synthetic tenant data only.
async (page) => {
  await page.goto('about:blank'); await page.unrouteAll({behavior:'wait'});
  const base='http://127.0.0.1:6337';
  const manifest=await (await page.request.get(base+'/e2e/navigation-manifest.json')).json();
  const definitions=[['IN_PROGRESS','ACTIVE','Active expedition'],['ON_HOLD','HOLD','Awaiting reinforcements'],
    ['WAITING_FOR_REQUIREMENT','PENDING','War council'],['DONE','COMPLETED','Victory hall']];
  let rows=definitions.map(([legacy_status,workflow_behavior,display_label],index)=>({id:'core-'+index,code:legacy_status==='DONE'?'CONQUERED':legacy_status==='WAITING_FOR_REQUIREMENT'?'BATTLE_PLAN':legacy_status,
    legacy_status,workflow_behavior,display_label,system_name:display_label,is_system:true,is_active:true,kanban_visible:true,
    description:'',color:'#6366f1',icon:'default',sort_order:index,task_count:0}));
  rows.push({id:'custom-pause',code:'CUSTOM_PAUSE',legacy_status:null,workflow_behavior:'HOLD',display_label:'Client approval',
    system_name:'Client approval',is_system:false,is_active:true,kanban_visible:true,description:'',color:'#f59e0b',icon:'clock',sort_order:4,task_count:0});
  let task={id:'business-quest',title:'Guard the crystal guild',description:'A synthetic expedition.',status:'IN_PROGRESS',custom_status_id:null,
    priority:'MEDIUM',team:'Engineering',created_by_id:'business-reviewer',assigned_to_id:'business-reviewer',can_edit:true,can_manage_subtasks:true,
    created_at:'2026-11-01T10:00:00Z',updated_at:'2026-11-01T10:00:00Z',due_at:'2026-11-01T12:00:00Z',
    subtasks:[],attachments:[],tags:[],dependencies:[],follower_ids:[],hold_started_at:null,hold_paused_seconds:0};
  let revision=1,failMove=false,failUpdate=false,configReads=0,historyReads=0;
  const moves=[],updates=[],cases=[],errors=[];
  const check=(value,name)=>{if(!value)throw Error(name);cases.push(name);};
  const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  const change=(destination,reason)=>{
    const native=destination.legacy_status||(destination.workflow_behavior==='HOLD'?'ON_HOLD':destination.workflow_behavior==='PENDING'?'WAITING_FOR_REQUIREMENT':'IN_PROGRESS');
    task={...task,status:native,custom_status_id:destination.is_system?null:destination.id,
      hold_reason:reason||null,hold_started_at:native==='ON_HOLD'?'2026-11-01T11:00:00Z':null,
      hold_paused_seconds:task.status==='ON_HOLD'?3600:task.hold_paused_seconds,completed_at:native==='DONE'?'2026-11-01T13:00:00Z':null};
  };
  await page.routeWebSocket('**/api/ws/**',socket=>socket.close({code:1000}));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/__business-rules'){
      const response=await route.fetch({url:base+'/'});
      return route.fulfill({response,body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/,'src="/e2e/settingsNavigationFixture.tsx"')});
    }
    if(url.pathname==='/api/navigation')return route.fulfill({json:{revision:0,actorRole:'owner',canManageGlobal:true,canManagePersonal:true,
      oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],pages:manifest.map(p=>({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:p.permittedRoles.includes('owner')?'allowed':'forbidden'}))}});
    if(url.pathname==='/api/task-statuses'){
      if(request.method()==='PUT'){const body=request.postDataJSON();rows=body.statuses.map((row,index)=>({...rows.find(saved=>saved.id===row.id),...row,sort_order:index}));revision++;}
      return route.fulfill({json:{revision,can_manage:true,hold_reason_required:true,statuses:rows}});
    }
    if(url.pathname==='/api/kanban-columns'){
      configReads++;return route.fulfill({json:rows.filter(row=>row.is_active).map(row=>({...row,id:row.legacy_status||row.id,title:row.display_label,order:row.sort_order,hold_reason_required:row.workflow_behavior==='HOLD'}))});
    }
    if(url.pathname==='/api/tasks/kanban')return route.fulfill({json:{configuration_revision:revision,columns:rows.map(row=>({status_id:row.id,status:row.legacy_status||row.id,title:row.display_label,
      workflow_behavior:row.workflow_behavior,hold_reason_required:row.workflow_behavior==='HOLD',order:row.sort_order,color:row.color,icon:row.icon,is_system:row.is_system,
      count:(task.custom_status_id||task.status)===(row.legacy_status||row.id)?1:0,items:(task.custom_status_id||task.status)===(row.legacy_status||row.id)?[task]:[]})),outside_columns:[],unmapped_count:0,unmapped_items:[]}});
    if(url.pathname==='/api/tasks/business-quest/kanban-status'){
      const body=request.postDataJSON();moves.push(body);
      if(body.configuration_revision!==undefined&&body.configuration_revision!==revision)return route.fulfill({status:409,json:{detail:'Status configuration changed. Close any move confirmation, refresh and choose the destination again.'}});
      if(failMove)return route.fulfill({status:422,json:{detail:'Hold policy changed. Review your reason.'}});
      change(rows.find(row=>row.id===body.status_id),body.hold_reason);return route.fulfill({json:task});
    }
    if(url.pathname==='/api/tasks/business-quest/holds'){
      historyReads++;return route.fulfill({json:[{id:'hold-1',started_at:'2026-11-01T11:00:00Z',ended_at:'2026-11-01T12:00:00Z',reason:'Approval pending',previous_status:'IN_PROGRESS',original_due_at:task.due_at,started_by_id:'business-reviewer',ended_by_id:'business-reviewer',source:'transition'}]});
    }
    if(url.pathname==='/api/tasks/business-quest'){
      if(request.method()==='PATCH'){
        const body=request.postDataJSON();updates.push(body);
        if(failUpdate)return route.fulfill({status:409,json:{detail:'Configuration changed. Retry your draft.'}});
        change(rows.find(row=>body.custom_status_id?row.id===body.custom_status_id:row.legacy_status===body.status),body.hold_reason);
      }
      return route.fulfill({json:task});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/__business-rules?role=owner&tenant=business-fixture&account=business-reviewer&kanban=live&business=live#/tasks/kanban');
  const panel=page.locator('#tasks-panel-kanban');
  await panel.getByText(task.title,{exact:true}).waitFor();
  check(await panel.getByRole('heading',{name:'Awaiting reinforcements',exact:true}).isVisible(),'renamed core Hold column keeps its internal behavior');
  const selector=()=>panel.getByRole('combobox',{name:'Move Guard the crystal guild to status',exact:true});
  await selector().selectOption('custom-pause');
  const holdDialog=page.getByRole('dialog',{name:'Place quest On Hold'});
  await holdDialog.getByRole('heading',{name:'Place quest On Hold'}).waitFor();
  check(await holdDialog.getByRole('button',{name:'Confirm hold'}).isDisabled(),'mandatory reason prevents empty confirmation');
  check(await holdDialog.getByRole('textbox',{name:'Hold reason'}).getAttribute('required')!==null,'hold reason is exposed as required to assistive technology');
  await holdDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  check(moves.length===0&&task.status==='IN_PROGRESS','cancelled hold makes no API mutation');
  await selector().selectOption('custom-pause');
  await holdDialog.getByRole('textbox',{name:'Hold reason'}).fill('Approval pending');failMove=true;
  await holdDialog.getByRole('button',{name:'Confirm hold'}).click();
  await holdDialog.getByRole('alert').waitFor();
  check(await holdDialog.getByRole('textbox',{name:'Hold reason'}).inputValue()==='Approval pending'&&task.status==='IN_PROGRESS','failed hold retains reason and source task');
  failMove=false;
  rows[0].display_label='Concurrent active expedition';revision++;
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:business-fixture',newValue:'changed-during-hold'})));
  await panel.getByRole('heading',{name:'Concurrent active expedition',exact:true,includeHidden:true}).waitFor({state:'attached'});
  await holdDialog.getByRole('button',{name:'Confirm hold'}).click();
  await holdDialog.getByRole('alert').filter({hasText:'Status configuration changed'}).waitFor();
  check(moves.at(-1).configuration_revision===revision-1,'open hold confirmation retains the originally reviewed configuration revision');
  await holdDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await selector().selectOption('custom-pause');
  await holdDialog.getByRole('textbox',{name:'Hold reason'}).fill('Approval pending');
  await holdDialog.getByRole('button',{name:'Confirm hold'}).click();
  await panel.locator('[data-task-status="custom-pause"]').getByText(task.title,{exact:true}).waitFor();
  check(moves.at(-1).status_id==='custom-pause'&&moves.at(-1).hold_reason==='Approval pending'&&task.status==='ON_HOLD','custom Hold submits internal ID and reason through shared endpoint');
  check(moves.at(-1).configuration_revision===revision,'reviewed retry uses the latest configuration revision');
  await selector().selectOption('core-0');await panel.locator('[data-task-status="IN_PROGRESS"]').getByText(task.title,{exact:true}).waitFor();
  check(task.hold_paused_seconds===3600&&moves.at(-1).status_id==='core-0','resume retains accumulated hold and uses immutable active ID');
  await selector().selectOption('core-3');await panel.locator('[data-task-status="DONE"]').getByText(task.title,{exact:true}).waitFor();
  check(moves.at(-1).status_id==='core-3'&&task.completed_at,'renamed completion column uses registered core identity');
  await panel.locator('[data-task-id="business-quest"]').getByRole('button',{name:'Edit',exact:true}).click();
  const status=page.getByRole('combobox',{name:'Status',exact:true});await status.waitFor();
  check(await status.getByRole('option',{name:'Client approval',exact:true}).count()===1&&configReads>0,'details fetches custom statuses from the registry');
  await status.selectOption('custom-pause');
  check(await page.getByRole('button',{name:'Update Task',exact:true}).isDisabled(),'details enforces required hold reason before save');
  await page.getByRole('textbox',{name:'Task hold reason'}).fill('Council reviewing');
  failUpdate=true;await page.getByRole('button',{name:'Update Task',exact:true}).click();
  await page.getByText('Configuration changed. Retry your draft.',{exact:true}).waitFor();
  check(await status.inputValue()==='custom-pause'&&await page.getByRole('textbox',{name:'Task hold reason'}).inputValue()==='Council reviewing','details retains draft on rejected concurrent update');
  failUpdate=false;await page.getByRole('button',{name:'Update Task',exact:true}).click();
  await page.getByText('On Hold since',{exact:false}).waitFor();
  check(updates.at(-1).custom_status_id==='custom-pause'&&updates.at(-1).hold_reason==='Council reviewing'&&!('status' in updates.at(-1)),'details custom mapping sends immutable ID without inventing native behavior');
  await page.getByText('Audited hold history',{exact:true}).click();await page.getByText('Approval pending',{exact:false}).waitFor();
  check(historyReads===1,'hold audit history loads lazily through task-authorized endpoint');
  const before=configReads;rows[0].display_label='Marching to battle';revision++;
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:business-fixture',newValue:'new-revision'})));
  await status.getByRole('option',{name:'Marching to battle',exact:true}).waitFor({state:'attached'});
  check(configReads>before,'open task details refreshes tenant-scoped labels during concurrent editing');
  rows.find(row=>row.id==='custom-pause').is_active=false;
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:business-fixture',newValue:'inactive-current-status'})));
  await status.getByRole('option',{name:'Current status unavailable (custom-pause); choose a registered destination',exact:true}).waitFor({state:'attached'});
  check(await status.inputValue()==='custom-pause','inactive current status remains explicitly identified in task details');
  await status.selectOption('IN_PROGRESS');
  await page.getByRole('button',{name:'Update Task',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select[id]')!==null);
  await page.getByText('On Hold since',{exact:false}).waitFor({state:'hidden'});
  check(updates.at(-1).status==='IN_PROGRESS'&&updates.at(-1).custom_status_id===null,'task can recover from unavailable status into a registered native destination');
  await page.setViewportSize({width:375,height:850});
  check(await status.evaluate(el=>el.getBoundingClientRect().width<=innerWidth),'status control fits compact viewport');
  await page.screenshot({path:'F:/Projects/ideashop-zeaplay-v5/artifacts/core-status-business-rules-mobile.png'});
  await page.evaluate(()=>{location.hash='/settings/sidebar-management';});
  const settings=page.locator('section[aria-labelledby="status-management-heading"]');
  await settings.getByLabel('Workflow behavior 1',{exact:true}).waitFor();
  check(await settings.getByLabel('Workflow behavior 1',{exact:true}).isDisabled(),'core business behavior is locked in Settings');
  const reasonPolicy=settings.getByRole('checkbox',{name:'Require a reason when placing a task On Hold',exact:true});
  check(await reasonPolicy.isChecked(),'tenant hold-reason policy is visible in Settings');
  await reasonPolicy.uncheck();
  await settings.getByRole('button',{name:'Cancel',exact:true}).click();
  check(await reasonPolicy.isChecked(),'Cancel restores saved hold policy with the status draft');
  await settings.getByRole('button',{name:'Add Custom Status',exact:true}).click();
  check(await settings.getByLabel('Workflow behavior 6',{exact:true}).inputValue()==='ACTIVE','new custom statuses default to explicit Active behavior');
  check(errors.length===0,'no browser rendering exceptions');
  page.off('pageerror',onError);return {passed:cases.length,cases};
}
