// Run with browser_run_code_unsafe(filename=absolute path) against Vite :6337.
// Actual Settings UI, synthetic APIs. Backend authorization is tested separately.
async (page) => {
  const onDialog = dialog => dialog.accept();
  page.on('dialog', onDialog);
  await page.goto('about:blank');
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const names = [['WAITING_FOR_REQUIREMENT','BATTLE_PLAN','Battle Plan'],['TODO','TODO','Case Filed'],['IN_PROGRESS','IN_PROGRESS','In Progress'],
    ['BUG_FIXING','BUG_FIXING','Bug Fixing'],['BLOCKED','BLOCKED','Boss Encounter'],['IN_REVIEW','IN_REVIEW','Tactical Shift'],
    ['ON_HOLD','ON_HOLD','On Hold'],['DONE','CONQUERED','Conquered'],['DEPLOYED','DEPLOYED','Deployed'],['FAILED','FAILED','Fallen'],['GRAVEYARD','GRAVEYARD','Graveyard']];
  let doc = { revision: 0, can_manage: true, statuses: names.map(([legacy_status, code, name], i) => ({ id:'status-'+i, code,
    system_name:name, display_label:name, legacy_status, description:'', color:'#6366f1', icon:'circle', is_system:true,
    is_active:true, kanban_visible:true, sort_order:i, task_count:0, default_sort_order:i, default_display_label:name, default_color:'#6366f1', default_icon:'default' })) };
  const cases = [], writes = [], errors = [];
  let conflict = false;
  const check = (condition, name) => { if (!condition) throw Error(name); cases.push(name); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.unrouteAll({behavior:'wait'});
  await page.routeWebSocket('**/api/ws/**', socket => socket.close({code:1000}));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__status-management') {
      const response = await route.fetch({url:base+'/'});
      return route.fulfill({response, body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/settingsNavigationFixture.tsx"')});
    }
    if (url.pathname === '/api/navigation') return route.fulfill({json:{ revision:0, actorRole:'owner', canManageGlobal:true,
      canManagePersonal:true, oauthManagementAccess:'allowed', roles:['owner','admin','manager','user'], apiSections:[],
      pages:manifest.map(p=>({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:p.permittedRoles.includes('owner')?'allowed':'forbidden'})) }});
    if (url.pathname === '/api/task-statuses') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON(); writes.push(body);
        if (conflict) return route.fulfill({status:409,json:{detail:'Status configuration changed. Cancel or reset to load the latest version.'}});
        const labels=body.statuses.map(row=>row.display_label.normalize('NFKC').trim().toLowerCase());
        if(new Set(labels).size!==labels.length)return route.fulfill({status:422,json:{detail:'Status labels must be unique'}});
        doc = { ...doc, revision:doc.revision+1, statuses:body.statuses.map((item,i)=>({
          ...doc.statuses.find(row=>row.id===item.id), ...item, id:item.id||'custom-'+doc.revision+'-'+i,
          code:doc.statuses.find(row=>row.id===item.id)?.code||'CUSTOM_TEST', is_system:!!doc.statuses.find(row=>row.id===item.id)?.is_system,
          legacy_status:doc.statuses.find(row=>row.id===item.id)?.legacy_status||null, sort_order:i,
          task_count:doc.statuses.find(row=>row.id===item.id)?.task_count||0,
        })) };
      }
      return route.fulfill({json:doc});
    }
    if (/\/api\/task-statuses\/.+\/remove/.test(url.pathname)) {
      const body = route.request().postDataJSON(); writes.push(body);
      const id = url.pathname.split('/')[3];
      doc = {...doc,revision:doc.revision+1,statuses:body.action==='delete'?doc.statuses.filter(row=>row.id!==id):doc.statuses.map(row=>row.id===id?{...row,is_active:false,task_count:0}:row)};
      return route.fulfill({json:doc});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:[]});
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/__status-management?role=owner&tenant=status-fixture&account=status-reviewer#/settings/sidebar-management');
  const root = page.locator('section[aria-labelledby="status-management-heading"]');
  await root.getByRole('heading',{name:'Status Management',exact:true}).waitFor();
  await root.getByRole('textbox',{name:'Status name 1',exact:true}).waitFor();
  check(await root.getByRole('textbox',{name:'Status name 1',exact:true}).isDisabled(),'system internal name locked');
  await root.getByText('System Status',{exact:true}).first().hover();
  await page.getByRole('tooltip').filter({hasText:'This is a core ZeaPlay system status.'}).waitFor();
  cases.push('system protection tooltip');
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').filter({hasText:'This is a core ZeaPlay system status.'}).waitFor({state:'hidden'});
  cases.push('hover tooltip can be dismissed with Escape');
  await page.mouse.move(0,0);
  const lockTrigger=root.locator('[aria-describedby]').filter({hasText:'System Status'}).first();
  await lockTrigger.focus();
  await page.getByRole('tooltip').filter({hasText:'This is a core ZeaPlay system status.'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').filter({hasText:'This is a core ZeaPlay system status.'}).waitFor({state:'hidden'});
  cases.push('keyboard tooltip focus and Escape dismissal');
  check(await root.getByRole('checkbox',{name:'Show Battle Plan on Kanban',exact:true}).isDisabled(),'system visibility is locked');
  const preview = root.locator('section[aria-labelledby="kanban-preview-heading"]');
  await root.getByRole('textbox',{name:'Display label 1',exact:true}).fill('Weekly Planning');
  await preview.getByRole('heading',{name:'Weekly Planning',exact:true}).waitFor();
  check(!writes.length,'preview label changes immediately before saving');
  check(await page.evaluate(()=>{ const event=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; }), 'unsaved edits warn before tab unload');
  await page.getByRole('navigation',{name:'Sidebar',exact:true}).getByRole('link',{name:'All Tasks',exact:true}).click();
  const leaveDialog=page.getByRole('dialog',{name:'Leave without saving?',exact:true});
  await leaveDialog.getByRole('heading',{name:'Leave without saving?',exact:true}).waitFor();
  await leaveDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  check(await root.getByRole('textbox',{name:'Display label 1',exact:true}).inputValue()==='Weekly Planning','navigation warning preserves draft when cancelled');
  await preview.getByRole('button',{name:'Compact preview',exact:true}).click();
  const compact=preview.getByRole('region',{name:'Compact Kanban preview',exact:true});
  check(await compact.evaluate(el=>el.scrollWidth>el.clientWidth),'compact preview scrolls horizontally');
  await preview.getByRole('button',{name:'Desktop preview',exact:true}).click();
  await root.getByRole('button',{name:'Cancel',exact:true}).click();
  check(await root.getByRole('textbox',{name:'Display label 1',exact:true}).inputValue()==='Battle Plan','cancel restores saved label');
  await root.getByRole('button',{name:'Add Custom Status',exact:true}).click();
  await root.getByRole('textbox',{name:'Status name 12',exact:true}).fill('Client Review');
  await root.getByRole('textbox',{name:'Display label 12',exact:true}).fill('Awaiting Client');
  await root.getByRole('textbox',{name:'Description 12',exact:true}).fill('Review client feedback');
  await root.getByLabel('Color 12',{exact:true}).fill('#123abc');
  await root.getByLabel('Icon 12',{exact:true}).selectOption('flag');
  const customPreview=preview.locator('[data-preview-code=""]');
  await customPreview.getByRole('heading',{name:'Awaiting Client',exact:true}).waitFor();
  check(await customPreview.evaluate(el=>el.style.borderColor==='rgb(18, 58, 188)'),'draft accent appears in preview');
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  check(writes[0].statuses.length===12 && !('is_system' in writes[0].statuses[0]) && !('code' in writes[0].statuses[0]),'save sends only editable attributes');
  await root.getByRole('button',{name:'Move Awaiting Client left',exact:true}).click();
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  check(doc.statuses[10].display_label==='Awaiting Client','keyboard ordering saved');
  const customRow = root.locator('tr[data-status-code="CUSTOM_TEST"]');
  await root.locator('tbody tr').nth(9).scrollIntoViewIfNeeded();
  await customRow.getByRole('button',{name:'Drag Awaiting Client',exact:true}).dragTo(root.locator('tbody tr').nth(9).locator('td').nth(1));
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  check(doc.statuses[9].display_label==='Awaiting Client','drag ordering saved');
  await customRow.getByRole('checkbox').uncheck();
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByText('Status configuration saved for this workspace.',{exact:true}).waitFor();
  check(!doc.statuses.find(row=>row.code==='CUSTOM_TEST').kanban_visible,'Kanban visibility saved');
  check(await preview.locator('[data-preview-code="CUSTOM_TEST"]').count()===0,'hidden custom excluded from preview');
  const writesBeforeReset=writes.length;
  await root.getByRole('button',{name:'Reset to default arrangement',exact:true}).click();
  check(await root.getByRole('textbox',{name:'Display label 12',exact:true}).inputValue()==='Client Review','reset stages custom name as default label');
  check(writes.length===writesBeforeReset,'default arrangement is unsaved until confirmed by Save');
  await root.getByRole('button',{name:'Cancel',exact:true}).click();
  doc.statuses.find(row=>row.code==='CUSTOM_TEST').task_count=2;
  await root.getByRole('button',{name:'Reset unsaved changes',exact:true}).click();
  await customRow.getByRole('cell',{name:'2',exact:true}).waitFor();
  await customRow.getByRole('button',{name:'Archive',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Confirm status removal',{exact:true}).fill('Awaiting Client');
  check(await dialog.getByRole('button',{name:'Confirm archive',exact:true}).isDisabled(),'referenced status requires reassignment');
  await dialog.getByLabel('Reassignment destination',{exact:true}).selectOption('status-2');
  await dialog.getByRole('button',{name:'Confirm archive',exact:true}).click();
  await root.getByText('Custom status archived.',{exact:true}).waitFor();
  check(writes.at(-1).expected_task_count===2 && writes.at(-1).confirmation==='Awaiting Client','explicit confirmed migration payload');
  await customRow.getByRole('button',{name:'Delete',exact:true}).click();
  await dialog.getByLabel('Confirm status removal',{exact:true}).fill('Awaiting Client');
  await dialog.getByRole('button',{name:'Confirm delete',exact:true}).click();
  await root.getByText('Custom status deleted. Audit history retained.',{exact:true}).waitFor();
  check(await root.locator('tbody tr').count()===11,'custom status removed; system statuses retained');
  conflict=true;
  await root.getByRole('textbox',{name:'Display label 1',exact:true}).fill('Conflicting edit');
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByRole('alert').filter({hasText:'Status configuration changed'}).waitFor();
  check(await root.getByText('Unsaved status changes',{exact:true}).isVisible(),'conflict keeps draft for review');
  await root.getByRole('button',{name:'Reset unsaved changes',exact:true}).click();
  await root.getByRole('alert').waitFor({state:'hidden'});
  conflict=false;
  await root.getByRole('textbox',{name:'Display label 2',exact:true}).fill(doc.statuses[0].display_label.toLowerCase());
  await root.getByRole('button',{name:'Save Status Changes',exact:true}).click();
  await root.getByRole('alert').filter({hasText:'Status labels must be unique'}).waitFor();
  check(await root.getByRole('textbox',{name:'Display label 2',exact:true}).inputValue()===doc.statuses[0].display_label.toLowerCase(),'duplicate-label rejection preserves editable draft');
  await root.getByRole('button',{name:'Cancel',exact:true}).click();
  await root.getByRole('textbox',{name:'Display label 1',exact:true}).fill('L'.repeat(80));
  await preview.getByRole('heading',{name:'L'.repeat(80),exact:true}).waitFor();
  doc={...doc,revision:doc.revision+1,statuses:doc.statuses.map((row,index)=>index===0?{...row,display_label:'Remote Planning'}:row)};
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:status-fixture',newValue:'concurrent-edit'})));
  await root.getByRole('alert').filter({hasText:'changed in another session'}).waitFor();
  check(await root.getByRole('textbox',{name:'Display label 1',exact:true}).inputValue()==='L'.repeat(80),'concurrent configuration update warns without overwriting draft');
  await root.getByRole('button',{name:'Reset unsaved changes',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Display label 1"]')?.value==='Remote Planning');
  check(await root.getByRole('textbox',{name:'Display label 1',exact:true}).inputValue()==='Remote Planning','explicit reload accepts latest concurrent configuration');
  doc={...doc,revision:doc.revision+1,statuses:doc.statuses.map((row,index)=>index===0?{...row,display_label:'Guild Planning'}:row)};
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'zea.kanban.configuration:status-fixture',newValue:'clean-refresh'})));
  await page.waitForFunction(()=>document.querySelector('[aria-label="Display label 1"]')?.value==='Guild Planning');
  cases.push('clean editor and preview refresh from another tab');
  await root.getByRole('textbox',{name:'Display label 1',exact:true}).fill('L'.repeat(80));
  await preview.getByRole('button',{name:'Compact preview',exact:true}).click();
  await page.setViewportSize({width:320,height:850});
  check(await preview.getByRole('heading',{name:'L'.repeat(80),exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth+1),'long preview label wraps at 320px');
  check(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'compact preview controls fit narrow panel');
  await root.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.setViewportSize({width:375,height:850});
  check(await root.getByRole('button',{name:'Add Custom Status',exact:true}).isVisible(),'mobile controls visible');
  check(await root.locator('table').evaluate(table=>table.parentElement.scrollWidth>table.parentElement.clientWidth),'mobile table scrolls within container');
  await root.getByRole('region',{name:'Task status configuration table'}).focus();
  check(await root.getByRole('region',{name:'Task status configuration table'}).evaluate(region=>document.activeElement===region),'table scroll region is keyboard reachable');
  await page.mouse.move(0,0);
  await lockTrigger.focus();
  const tooltip=page.locator(`[role="tooltip"][id="${await lockTrigger.getAttribute('aria-describedby')}"]`);
  await tooltip.waitFor();
  const rect=await tooltip.boundingBox();
  check(rect.x>=0 && rect.x+rect.width<=375,'mobile system tooltip stays within viewport');
  await page.keyboard.press('Escape');
  check(errors.length===0,'no browser rendering exceptions');
  await page.mouse.move(0,0);
  await preview.getByRole('button',{name:'Desktop preview',exact:true}).focus();
  await page.setViewportSize({width:1440,height:1000});
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({path:'F:/Projects/ideashop-zeaplay-v5/artifacts/kanban-preview-desktop.png'});
  await preview.getByRole('button',{name:'Compact preview',exact:true}).click();
  await page.setViewportSize({width:375,height:850});
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({path:'F:/Projects/ideashop-zeaplay-v5/artifacts/kanban-preview-compact.png'});
  page.off('pageerror',onError);
  page.off('dialog',onDialog);
  const result = {passed:cases.length,cases};
  await page.evaluate(result => { window.statusManagementTestResult = result; }, result);
  return result;
}
