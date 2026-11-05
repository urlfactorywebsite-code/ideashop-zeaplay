// Full browser -> actual HTTP adapter -> FastAPI/JWT -> isolated SQL database.
async (page) => {
  const base='http://127.0.0.1:6337',api='http://127.0.0.1:6338';
  const setup=await (await page.request.get(api+'/__fixture/setup')).json();
  const headers={Authorization:'Bearer '+setup.token};
  const manifest=await (await page.request.get(base+'/e2e/navigation-manifest.json')).json();
  const cases=[],errors=[];const check=(condition,name)=>{if(!condition)throw Error(name);cases.push(name);};
  const onError=error=>errors.push(error.message);page.on('pageerror',onError);
  await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});
  await page.routeWebSocket('**/api/ws/**',socket=>socket.close({code:1000}));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/__core-status-live'){
      const response=await route.fetch({url:base+'/'});
      return route.fulfill({response,body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/,'src="/e2e/settingsNavigationFixture.tsx"')});
    }
    // Navigation shell is synthetic. Every status/task request reaches FastAPI.
    if(url.pathname==='/api/navigation')return route.fulfill({json:{revision:0,actorRole:'owner',canManageGlobal:true,canManagePersonal:true,
      oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],pages:manifest.map(p=>({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:p.permittedRoles.includes('owner')?'allowed':'forbidden'}))}});
    return route.continue();
  });
  await page.addInitScript(token=>sessionStorage.setItem('zea.e2e.access_token',token),setup.token);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+`/__core-status-live?role=owner&tenant=${setup.tenant}&account=${setup.owner}&kanban=live&business=live#/tasks/kanban`);
  const panel=page.locator('#tasks-panel-kanban');
  await panel.locator('[data-task-status="WAITING_FOR_REQUIREMENT"]').getByText('Live status expedition',{exact:true}).waitFor();
  const get=async path=>{const response=await page.request.get(api+path,{headers});check(response.ok(),'authorized API read '+path);return response.json();};
  const doc=await get('/api/task-statuses');
  const id=code=>doc.statuses.find(row=>row.code===code).id;
  check((await get('/api/tasks/'+setup.task)).status==='WAITING_FOR_REQUIREMENT','database default creates Battle Plan');
  const originalDue=(await get('/api/tasks/'+setup.task)).due_at;
  await page.evaluate(()=>{location.hash='/settings/sidebar-management';});
  const settings=page.locator('section[aria-labelledby="status-management-heading"]');
  await settings.getByRole('textbox',{name:'Display label 1',exact:true}).fill('Live War Council');
  await settings.getByRole('button',{name:'Move Live War Council right',exact:true}).click();
  await settings.getByRole('checkbox',{name:'Require a reason when placing a task On Hold',exact:true}).check();
  await settings.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await settings.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  await page.evaluate(()=>{location.hash='/tasks/kanban';});
  await panel.getByRole('heading',{name:'Live War Council',exact:true}).waitFor();
  check(await panel.locator('[data-task-status]').nth(1).getAttribute('data-task-status')==='WAITING_FOR_REQUIREMENT','saved order and custom label reach actual board from database');
  const selector=()=>panel.getByRole('combobox',{name:'Move Live status expedition to status',exact:true});
  await selector().selectOption(id('IN_PROGRESS'));
  await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Live status expedition',{exact:true}).waitFor();
  await selector().selectOption(id('ON_HOLD'));
  const hold=page.getByRole('dialog',{name:'Place quest On Hold'});
  await hold.getByRole('heading').waitFor();check(await hold.getByRole('button',{name:'Confirm hold'}).isDisabled(),'saved required-reason policy controls live hold form');
  await hold.getByRole('textbox',{name:'Hold reason'}).fill('Live client approval');await hold.getByRole('button',{name:'Confirm hold'}).click();
  await panel.locator('[data-task-status="ON_HOLD"]').getByText('Live status expedition',{exact:true}).waitFor();
  let saved=await get('/api/tasks/'+setup.task);
  check(saved.status==='ON_HOLD'&&saved.hold_started_at&&saved.due_at===originalDue,'hold persists original deadline and audited start in real SQL');
  const repeated=await page.request.patch(api+'/api/tasks/'+setup.task+'/kanban-status',{headers,data:{status_id:id('ON_HOLD'),hold_reason:'Live client approval'}});
  check(repeated.ok()&&(await get('/api/tasks/'+setup.task+'/holds')).length===1,'retried real transition produces one hold interval');
  await selector().selectOption(id('IN_PROGRESS'));
  await panel.locator('[data-task-status="IN_PROGRESS"]').getByText('Live status expedition',{exact:true}).waitFor();
  saved=await get('/api/tasks/'+setup.task);
  check(saved.hold_started_at===null&&saved.hold_paused_seconds>0&&saved.due_at===originalDue,'resume closes real hold and accumulates eligible seconds');
  await selector().selectOption(id('CONQUERED'));
  await panel.locator('[data-task-status="DONE"]').getByText('Live status expedition',{exact:true}).waitFor();
  const awarded=await get('/__fixture/state');check(awarded.completed===1&&awarded.points>125,'live completion rewards once through existing engine');
  for(let retry=0;retry<2;retry++)check((await page.request.post(api+'/api/tasks/'+setup.task+'/complete',{headers})).ok(),'completion retry '+(retry+1));
  const retried=await get('/__fixture/state');check(retried.points===awarded.points&&retried.completed===1,'HTTP completion retries preserve one-time points marker');
  const denied=await page.request.patch(api+'/api/tasks/'+setup.task+'/kanban-status',{headers:{Authorization:'Bearer '+setup.foreign_token},data:{status_id:id('IN_PROGRESS')}});
  check([403,404].includes(denied.status()),'real foreign-tenant JWT cannot move task');
  check(retried.history>0&&retried.config_audits>0,'real lifecycle and configuration audit records remain present');
  await page.reload();await panel.getByRole('heading',{name:'Live War Council',exact:true}).waitFor();
  check(await panel.locator('[data-task-status="DONE"]').getByText('Live status expedition',{exact:true}).isVisible(),'browser refresh retains saved arrangement and completed task');
  check(errors.length===0,'live frontend has no rendering exceptions');
  page.off('pageerror',onError);return {passed:cases.length,cases};
}
