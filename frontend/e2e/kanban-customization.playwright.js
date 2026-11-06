// Actual All Tasks / Settings components and API adapters with synthetic HTTP data.
// Run through browser_run_code_unsafe against the local Vite server on :6337.
async (page) => {
  await page.goto('about:blank');
  await page.unrouteAll({behavior:'wait'});
  const base='http://127.0.0.1:6337';
  const manifest=await (await page.request.get(base+'/e2e/navigation-manifest.json')).json();
  const names=[['WAITING_FOR_REQUIREMENT','BATTLE_PLAN','Battle Plan'],['TODO','TODO','Case Filed'],['IN_PROGRESS','IN_PROGRESS','In Progress'],
    ['BUG_FIXING','BUG_FIXING','Bug Fixing'],['BLOCKED','BLOCKED','Boss Encounter'],['IN_REVIEW','IN_REVIEW','Tactical Shift'],
    ['ON_HOLD','ON_HOLD','On Hold'],['DONE','CONQUERED','Conquered'],['DEPLOYED','DEPLOYED','Deployed'],['FAILED','FAILED','Fallen'],['GRAVEYARD','GRAVEYARD','Graveyard']];
  let doc={revision:0,can_manage:true,statuses:names.map(([legacy_status,code,name],index)=>({id:'system-'+index,code,system_name:name,
    display_label:name,legacy_status,description:'',color:'#6366f1',icon:'default',is_system:true,is_active:true,kanban_visible:true,sort_order:index,task_count:0,
    default_sort_order:index,default_display_label:name,default_color:'#6366f1',default_icon:'default'}))};
  doc.statuses.push({id:'custom-review',code:'CUSTOM_REVIEW',system_name:'Client Review',display_label:'Client Review',legacy_status:null,
    color:'#12ab34',icon:'flag',description:'',is_system:false,is_active:true,kanban_visible:true,sort_order:11,task_count:1});
  doc.statuses.push({id:'custom-hidden',code:'CUSTOM_HIDDEN',system_name:'Hidden Review',display_label:'Hidden Review',legacy_status:null,
    color:'#ab1234',icon:'clock',description:'',is_system:false,is_active:true,kanban_visible:false,sort_order:12,task_count:1});
  let tasks=Array.from({length:23},(_,index)=>({id:'quest-'+index,title:'Guild quest '+index,description:'Explore the ancient guild ruins.',
    status:'IN_PROGRESS',custom_status_id:null,priority:'MEDIUM',team:'Engineering',assigned_to_id:'kanban-reviewer',created_by_id:'kanban-reviewer',
    created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',due_at:null,can_edit:true,subtasks:[],attachments:[],tags:[]}));
  tasks.push({...tasks[0],id:'custom-task',title:'Customer quest',custom_status_id:'custom-review'});
  tasks.push({...tasks[0],id:'hidden-task',title:'Retained hidden quest',custom_status_id:'custom-hidden'});
  tasks.push({...tasks[0],id:'readonly-task',title:'Read only quest',status:'TODO',can_edit:false});
  doc.statuses.push({id:'inactive-status',code:'CUSTOM_INACTIVE',system_name:'Inactive Stage',display_label:'Inactive Stage',legacy_status:null,
    color:'#ab1234',icon:'clock',description:'',is_system:false,is_active:false,kanban_visible:true,sort_order:13,task_count:0});
  let legacyCount=1;
  let failLoad=false,failMove=false;
  const cases=[],moves=[],queries=[],errors=[];
  const check=(condition,name)=>{if(!condition)throw Error(name);cases.push(name);};
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  await page.routeWebSocket('**/api/ws/**',socket=>socket.close({code:1000}));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/__kanban-customization'){
      const response=await route.fetch({url:base+'/'});
      return route.fulfill({response,body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/,'src="/e2e/settingsNavigationFixture.tsx"')});
    }
    if(url.pathname==='/api/navigation')return route.fulfill({json:{revision:0,actorRole:'owner',canManageGlobal:true,canManagePersonal:true,
      oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],pages:manifest.map(p=>({...p,enabled:true,hidden:false,
      allowedRoles:p.permittedRoles,access:p.permittedRoles.includes('owner')?'allowed':'forbidden'}))}});
    if(url.pathname==='/api/task-statuses'){
      if(request.method()==='PUT'){
        const body=request.postDataJSON();
        doc={...doc,revision:doc.revision+1,statuses:body.statuses.map((row,index)=>({...doc.statuses.find(s=>s.id===row.id),...row,sort_order:index}))};
      }
      return route.fulfill({json:doc});
    }
    if(url.pathname==='/api/tasks/kanban'){
      queries.push(Object.fromEntries(url.searchParams));
      if(failLoad)return route.fulfill({status:503,json:{detail:'Synthetic temporary outage'}});
      const columns=[],outside_columns=[];
      const size=Number(url.searchParams.get('page_size')||20),offset=(Number(url.searchParams.get('page')||1)-1)*size;
      const search=url.searchParams.get('search')?.toLowerCase()||'';
      for(const row of doc.statuses){
        const matching=tasks.filter(task=>(task.custom_status_id||task.status)===(row.legacy_status||row.id)&&task.title.toLowerCase().includes(search));
        const column={status_id:row.id,status:row.legacy_status||row.id,title:row.display_label,order:row.sort_order,color:row.color,icon:row.icon,
          is_system:row.is_system,count:matching.length,items:matching.slice(offset,offset+size)};
        if(row.is_active&&row.kanban_visible)columns.push(column);
        else if(matching.length)outside_columns.push({...column,outside_reason:row.is_active?'hidden':'archived'});
      }
      return route.fulfill({json:{configuration_revision:doc.revision,columns,outside_columns,unmapped_count:legacyCount,
        unmapped_items:Array.from({length:legacyCount},(_,index)=>({id:index?'legacy-'+index:'legacy-quest',title:index?'Legacy retained quest '+index:'Legacy retained quest',raw_status:'OLD_STAGE',custom_status_id:null})).slice(offset,offset+size)}});
    }
    if(/\/api\/tasks\/.+\/kanban-status$/.test(url.pathname)){
      const body=request.postDataJSON(),id=url.pathname.split('/')[3];moves.push(body);
      if(failMove)return route.fulfill({status:409,json:{detail:'Destination changed. Refresh and try again.'}});
      const destination=doc.statuses.find(row=>row.id===body.status_id);
      tasks=tasks.map(task=>task.id===id?{...task,status:destination.legacy_status||'IN_PROGRESS',custom_status_id:destination.is_system?null:destination.id}:task);
      return route.fulfill({json:tasks.find(task=>task.id===id)});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/__kanban-customization?role=owner&tenant=kanban-fixture&account=kanban-reviewer&kanban=live#/tasks/kanban');
  const panel=page.locator('#tasks-panel-kanban');
  await panel.locator('[data-task-status="IN_PROGRESS"]').waitFor();
  check(await panel.locator('[data-task-status]').count()===12,'columns come only from active visible registered statuses');
  check(await panel.getByText('Add Stage',{exact:true}).count()===0,'hardcoded placeholder removed');
  check(await panel.locator('[data-task-status="IN_PROGRESS"]').getByLabel('23 tasks',{exact:true}).isVisible(),'header shows full task count across pages');
  check(await panel.getByText('Retained hidden quest',{exact:true}).isVisible(),'hidden custom quest remains available outside board columns');
  check(await panel.locator('[data-task-id="readonly-task"]').getAttribute('draggable')==='false'
    &&await panel.locator('[data-task-id="readonly-task"]').getByRole('button',{name:'Edit',exact:true}).count()===0
    &&await panel.getByRole('combobox',{name:'Move Read only quest to status',exact:true}).count()===0,'read-only cards have no drag, edit or move controls');
  check(await panel.getByRole('heading',{name:'Inactive Stage',exact:true}).count()===0,'inactive custom columns excluded');
  check(await panel.getByText('Legacy retained quest / legacy-quest / OLD_STAGE',{exact:true}).isVisible(),'unmapped legacy record explicitly retained');
  check(await panel.getByRole('button',{name:'View',exact:true}).first().isVisible()&&await panel.getByRole('button',{name:'Edit',exact:true}).first().isVisible(),'existing card actions retained');
  await panel.getByRole('button',{name:'Next page',exact:true}).click();
  await panel.getByText('Guild quest 22',{exact:true}).waitFor();
  check(queries.at(-1).page==='2','per-column pagination preserved');
  await panel.getByRole('button',{name:'Prev page',exact:true}).click();
  await panel.getByText('Guild quest 0',{exact:true}).waitFor();
  const drop=async (title,status)=>{
    const transfer=await page.evaluateHandle(()=>new DataTransfer());
    const card=panel.locator('[draggable="true"]').filter({has:page.getByText(title,{exact:true})});
    await card.dispatchEvent('dragstart',{dataTransfer:transfer});
    await panel.locator(`[data-task-status="${status}"]`).dispatchEvent('drop',{dataTransfer:transfer});
    await transfer.dispose();
  };
  await drop('Guild quest 0','custom-review');
  await panel.locator('[data-task-status="custom-review"]').getByText('Guild quest 0',{exact:true}).waitFor();
  check(moves.at(-1).status_id==='custom-review'&&moves.at(-1).configuration_revision===doc.revision&&Object.keys(moves.at(-1)).length===2,'task drag uses immutable registered status ID and configuration revision');
  failMove=true;
  await drop('Guild quest 1','ON_HOLD');
  await panel.getByRole('alert').filter({hasText:'Destination changed'}).waitFor();
  check(await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Guild quest 1',{exact:true}).isVisible(),'failed task move restores original card and reports error');
  failMove=false;
  await panel.locator('[data-task-id="quest-1"]').dragTo(panel.locator('[data-task-status="TODO"] h3'),{sourcePosition:{x:30,y:30},targetPosition:{x:30,y:15}});
  await panel.locator('[data-task-status="TODO"]').getByText('Guild quest 1',{exact:true}).waitFor();
  check(moves.at(-1).status_id==='system-1','native pointer drag moves to immutable system ID');
  await panel.getByRole('button',{name:'100 per page',exact:true}).click();
  await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Guild quest 22',{exact:true}).waitFor();
  await panel.getByRole('combobox',{name:'Move Retained hidden quest to status',exact:true}).selectOption('system-2');
  await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Retained hidden quest',{exact:true}).waitFor();
  check(moves.at(-1).status_id==='system-2','keyboard and touch selector recovers hidden-status task');
  await panel.getByPlaceholder('Search Tasks',{exact:true}).fill('Customer quest');
  await panel.getByText('Customer quest',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('[data-task-status="IN_PROGRESS"] [draggable="true"]').length===0);
  check(queries.at(-1).search==='Customer quest','search still filters through backend API');
  await panel.getByPlaceholder('Search Tasks',{exact:true}).fill('');
  await panel.getByText('Guild quest 1',{exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='/settings/sidebar-management';});
  const settings=page.locator('section[aria-labelledby="status-management-heading"]');
  await settings.getByRole('textbox',{name:'Display label 1',exact:true}).fill('Council Planning');
  await settings.getByLabel('Color 1',{exact:true}).fill('#ab12cd');
  await settings.getByLabel('Icon 1',{exact:true}).selectOption('star');
  await settings.getByRole('button',{name:'Move Council Planning right',exact:true}).click();
  await settings.getByRole('checkbox',{name:'Show Client Review on Kanban',exact:true}).uncheck();
  await settings.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await settings.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='/tasks/kanban';});
  await panel.getByRole('heading',{name:'Council Planning',exact:true}).waitFor();
  check(await panel.locator('[data-task-status]').nth(1).getAttribute('data-task-status')==='WAITING_FOR_REQUIREMENT','saved order and labels reflected in actual board');
  check(await panel.locator('[data-task-status="WAITING_FOR_REQUIREMENT"]').evaluate(el=>el.style.borderColor==='rgb(171, 18, 205)'),'saved accent reflected in actual board');
  check(await panel.locator('[data-task-status="custom-review"]').count()===0&&await panel.getByText('Customer quest',{exact:true}).isVisible(),'saved hidden status retains assigned tasks outside columns');
  await page.reload();
  await panel.getByRole('heading',{name:'Council Planning',exact:true}).waitFor();
  check(await panel.locator('[data-task-status]').nth(1).getAttribute('data-task-status')==='WAITING_FOR_REQUIREMENT','configuration persists after refresh');
  // Simulate another tab saving a newer arrangement for this tenant.
  doc.statuses.find(row=>row.code==='ON_HOLD').display_label='Awaiting reinforcements';doc.revision++;
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:kanban-fixture',newValue:'new-revision'})));
  await panel.getByRole('heading',{name:'Awaiting reinforcements',exact:true}).waitFor();
  cases.push('tenant-scoped cross-tab configuration refresh');
  failLoad=true;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('task-statuses-updated',{detail:{tenantId:'kanban-fixture'}})));
  await panel.getByRole('alert').filter({hasText:'Unable to load'}).waitFor();
  failLoad=false;
  await panel.getByRole('button',{name:'Retry',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'Unable to load'}).waitFor({state:'hidden'});
  cases.push('load failure and retry state');
  const beforeAlien=queries.length;
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:another-tenant',newValue:'new-revision'})));
  check(queries.length===beforeAlien,'other-tenant configuration event ignored');
  const longLabel='W'.repeat(80);
  doc.statuses.find(row=>row.code==='BATTLE_PLAN').display_label=longLabel;doc.revision++;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('task-statuses-updated',{detail:{tenantId:'kanban-fixture'}})));
  const longHeading=panel.getByRole('heading',{name:longLabel,exact:true});
  await longHeading.waitFor();
  check(await longHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'80-character unbroken label wraps inside column');
  await panel.getByRole('button',{name:'All Statuses',exact:true}).click();
  const filterList=panel.getByRole('listbox',{name:'All Statuses',exact:true});
  await filterList.getByRole('option',{name:'Client Review (hidden)',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#tasks-panel-kanban [data-task-status]').length===0);
  check(await panel.locator('[data-task-status]').count()===0&&await panel.getByText('Customer quest',{exact:true}).isVisible(),'status filter retains hidden-status cards with accurate view');
  doc.statuses=doc.statuses.filter(row=>row.id!=='custom-review');doc.revision++;
  tasks=tasks.map(task=>task.custom_status_id==='custom-review'?{...task,custom_status_id:null}:task);
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:kanban-fixture',newValue:'removed-status'})));
  await panel.getByText('The selected status is no longer available. Showing all statuses; reassigned quests may be on another page.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'100 per page',exact:true}).click();
  await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Customer quest',{exact:true}).waitFor();
  check(await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Customer quest',{exact:true}).isVisible(),'concurrent reassignment resets removed filter and retains task');
  legacyCount=45;
  await panel.getByRole('button',{name:'20 per page',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('task-statuses-updated',{detail:{tenantId:'kanban-fixture'}})));
  await panel.getByText('45 quests need status mapping',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'All Statuses',exact:true}).click();
  await filterList.getByRole('option',{name:'Case Filed',exact:true}).focus();
  await page.keyboard.press('Home');
  check(await filterList.getByRole('option',{name:'All Statuses',exact:true}).evaluate(el=>el===document.activeElement),'status list supports Home keyboard navigation');
  await filterList.getByRole('option',{name:'Case Filed',exact:true}).press('Enter');
  await panel.getByRole('button',{name:'Next page',exact:true}).click();
  await panel.getByRole('button',{name:'Next page',exact:true}).click();
  await panel.getByText('Legacy retained quest 44 / legacy-44 / OLD_STAGE',{exact:true}).waitFor();
  cases.push('all unmapped records remain paginated even with a status filter');
  tasks=[];legacyCount=0;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('task-statuses-updated',{detail:{tenantId:'kanban-fixture'}})));
  await panel.getByText('No quests on this page match the current filters.',{exact:true}).waitFor();
  check(await panel.getByRole('button',{name:'Next page',exact:true}).isDisabled(),'empty board has explicit state and disabled pagination');
  await panel.getByRole('button',{name:'All Statuses',exact:true}).click();
  await panel.getByRole('option',{name:'All Statuses',exact:true}).press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#tasks-panel-kanban [data-task-status]').length===11);
  await page.setViewportSize({width:375,height:850});
  check(await panel.locator('.kanban-board-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),'mobile board preserves horizontal scrolling');
  check(errors.length===0,'no browser rendering exceptions');
  await panel.locator('.kanban-board-scroll').scrollIntoViewIfNeeded();
  await page.screenshot({path:'F:/Projects/ideashop-zeaplay-v5/artifacts/kanban-customization-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await panel.locator('.kanban-board-scroll').scrollIntoViewIfNeeded();
  await page.screenshot({path:'F:/Projects/ideashop-zeaplay-v5/artifacts/kanban-customization-desktop.png'});
  page.off('pageerror',onError);
  return {passed:cases.length,cases};
}
