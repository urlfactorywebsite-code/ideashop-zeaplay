// Actual app views with synthetic HTTP catalogs. Backend permissions are tested separately.
async (page) => {
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const names = [['WAITING_FOR_REQUIREMENT','BATTLE_PLAN','Battle Plan'],['TODO','TODO','Case Filed'],['IN_PROGRESS','IN_PROGRESS','In Progress'],
    ['BUG_FIXING','BUG_FIXING','Bug Fixing'],['BLOCKED','BLOCKED','Boss Encounter'],['IN_REVIEW','IN_REVIEW','Tactical Shift'],
    ['ON_HOLD','ON_HOLD','On Hold'],['DONE','CONQUERED','Conquered'],['DEPLOYED','DEPLOYED','Deployed'],['FAILED','FAILED','Fallen'],['GRAVEYARD','GRAVEYARD','Graveyard']];
  const defaults = names.map(([legacy_status,code,name],i)=>({id:'status-'+i, code, system_name:name, display_label:name, legacy_status,
    description:'',color:'#6366f1',icon:'circle',is_system:true,is_active:true,kanban_visible:true,sort_order:i,task_count:0}));
  let doc = {revision:0, can_manage:true, statuses:structuredClone(defaults)};
  let role='owner', tenant='task-fixture', catalogReads=0;
  const cases=[],errors=[],writes=[];
  const check=(ok,name)=>{if(!ok)throw Error(name);cases.push(name);};
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.routeWebSocket('**/api/ws/**',socket=>socket.close({code:1000}));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/__status-renaming'){
      role=url.searchParams.get('role')||'owner';tenant=url.searchParams.get('tenant')||'task-fixture';
      const fixture=url.searchParams.get('fixture')==='settings'?'settingsNavigationFixture':'taskNavigationFixture';
      const response=await route.fetch({url:base+'/'});
      return route.fulfill({response,body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/,'src="/e2e/'+fixture+'.tsx"')});
    }
    if(url.pathname==='/api/navigation')return route.fulfill({json:{revision:0,actorRole:role,canManageGlobal:role==='owner',canManagePersonal:['owner','admin'].includes(role),oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],
      pages:manifest.map(p=>({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:p.permittedRoles.includes(role)?'allowed':'forbidden'}))}});
    if(url.pathname==='/api/kanban-columns'){
      catalogReads++;
      const statuses=tenant==='other-guild'?defaults:doc.statuses;
      return route.fulfill({json:statuses.map(row=>({id:row.legacy_status||row.id,custom_status_id:row.is_system?null:row.id,title:row.display_label,order:row.sort_order,is_active:row.is_active,kanban_visible:row.kanban_visible}))});
    }
    if(url.pathname==='/api/task-statuses'){
      if(route.request().method()==='PUT'){
        const body=route.request().postDataJSON();writes.push(body);
        doc={...doc,revision:doc.revision+1,statuses:body.statuses.map(item=>({...doc.statuses.find(row=>row.id===item.id),...item}))};
      }
      return route.fulfill({json:doc});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/__status-renaming?fixture=settings&role=owner&tenant=task-fixture#/settings/sidebar-management');
  const management=page.locator('section[aria-labelledby="status-management-heading"]');
  const row=management.locator('[data-status-code="IN_PROGRESS"]');
  await row.getByRole('button',{name:'Rename',exact:true}).click();
  const field=row.getByRole('textbox',{name:'Display label 3',exact:true});
  check(await field.evaluate(el=>document.activeElement===el&&el.selectionStart===0&&el.selectionEnd===el.value.length),'Rename focuses and selects the visible status name');
  await field.fill('Working Quest');
  check(await row.getByRole('textbox',{name:'Status name 3',exact:true}).inputValue()==='In Progress','renaming preserves the internal system name');
  await management.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await management.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  check(writes[0].statuses[2].id==='status-2'&&!('code' in writes[0].statuses[2]),'save uses the immutable ID and editable fields only');

  await page.goto(base+'/__status-renaming?role=owner&tenant=task-fixture#/tasks');
  const list=page.locator('#tasks-panel-list');
  await list.getByText('Working Quest',{exact:true}).first().waitFor();
  await list.getByText('Navigation task 1',{exact:true}).first().waitFor();
  const counter=list.locator('p').filter({hasText:/^Working Quest$/}).first().locator('..');
  check((await counter.textContent()).includes('1'),'renamed All Tasks counter retains its count');
  check(await list.locator('span[title]').filter({hasText:/^Working Quest$/}).count()>0,'task badge uses the renamed status');
  await list.getByRole('button',{name:'All Statuses',exact:true}).click();
  await page.getByRole('option',{name:'Working Quest',exact:true}).click();
  await page.waitForURL(/status=IN_PROGRESS/);
  await page.waitForFunction(()=>window.taskNavigationAudit.calls.some(call=>call.method==='getTasksPage'&&call.args[0]?.status==='IN_PROGRESS'));
  check(await page.evaluate(()=>window.taskNavigationAudit.calls.some(call=>call.method==='getTasksPage'&&call.args[0]?.status==='IN_PROGRESS')),'renamed filter sends the internal status code');

  doc={...doc,revision:doc.revision+1,statuses:doc.statuses.map(row=>row.code==='IN_PROGRESS'?{...row,display_label:'Crafting Quest'}:row)};
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:task-fixture',newValue:'renamed-in-another-tab'})));
  await list.getByRole('button',{name:'Crafting Quest',exact:true}).waitFor();
  check(await list.getByText('Crafting Quest',{exact:true}).count()>=2,'open list, counter and selected filter update after another owner session saves');
  const readsBeforeTabs=catalogReads;
  const tabs=page.getByRole('tablist',{name:'Task views'});
  await tabs.getByRole('tab',{name:'Calendar',exact:true}).click();
  const calendar=page.locator('#tasks-panel-calendar');
  await calendar.getByRole('heading',{name:'Calendar',exact:true}).waitFor();
  const select=calendar.locator('select').filter({has:page.locator('option[value="IN_PROGRESS"]')});
  check(await select.locator('option[value="IN_PROGRESS"]').textContent()==='Crafting Quest','Calendar filter shows the renamed label with the unchanged option value');
  await select.selectOption('IN_PROGRESS');
  await tabs.getByRole('tab',{name:'Gantt Chart',exact:true}).click();
  const gantt=page.locator('#tasks-panel-gantt');
  await gantt.getByRole('button',{name:'Crafting Quest',exact:true}).waitFor();
  check(await gantt.getByText('Crafting Quest',{exact:true}).count()>=2,'Gantt chips, task labels and legend use the shared name');
  check(catalogReads===readsBeforeTabs,'all task views and badges share one catalog read');
  await page.setViewportSize({width:375,height:850});
  check(await gantt.getByRole('button',{name:'Crafting Quest',exact:true}).isVisible(),'renamed Gantt filter remains accessible on mobile');

  await page.goto(base+'/__status-renaming?role=user&tenant=task-fixture#/tasks');
  await list.getByText('Crafting Quest',{exact:true}).first().waitFor();
  check(await list.getByText('Crafting Quest',{exact:true}).count()>=2,'ordinary users see the owner-renamed labels');
  await page.goto(base+'/__status-renaming?role=user&tenant=other-guild#/tasks');
  await list.getByText('In Progress',{exact:true}).first().waitFor();
  check(await list.getByText('Crafting Quest',{exact:true}).count()===0,'another tenant never receives the first guild name');
  const longName='L'.repeat(80);
  doc={...doc,revision:doc.revision+1,statuses:doc.statuses.map(row=>row.code==='IN_PROGRESS'?{...row,display_label:longName}:row)};
  await page.goto(base+'/__status-renaming?role=owner&tenant=task-fixture#/tasks');
  await list.getByText('Navigation task 1',{exact:true}).first().waitFor();
  await list.getByText(longName,{exact:true}).first().waitFor();
  const badge=list.locator('span[title]').filter({hasText:new RegExp('^L{80}$')}).first();
  check(await badge.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'80-character status badge wraps at mobile width');
  const longCounter=list.locator('p').filter({hasText:new RegExp('^L{80}$')}).first();
  check(await longCounter.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'80-character counter label wraps within its card');
  await tabs.getByRole('tab',{name:'Gantt Chart',exact:true}).click();
  const chip=gantt.getByRole('button',{name:longName,exact:true});
  await chip.waitFor();
  check(await chip.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'80-character Gantt filter wraps within mobile controls');
  check(errors.length===0,'no rendering exceptions during rename and view changes');
  return {passed:cases.length,cases};
}
