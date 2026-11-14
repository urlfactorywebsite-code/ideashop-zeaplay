// Real List/Grid components and HTTP adapters, with isolated synthetic responses.
async (page) => {
  await page.goto('about:blank');
  await page.unrouteAll({behavior:'wait'});
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const cases = [], errors = [], requests = [];
  const comments = new Map();
  const check = (value, name) => { if (!value) throw Error(name); cases.push(name); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  let failGroup = false, emptyGroup = false, restricted = false, denyUpdate = false, deferGroup = false, releaseGroup;
  let deferredTask = null, releaseTask;
  let visibleCount = 24;
  const wait = async predicate => { const end = Date.now() + 15000; while (!predicate()) {
    if (Date.now() > end) throw Error('Timed out waiting for fixture request'); await page.waitForTimeout(25);
  } };
  const assignments = Array.from({length:24}, (_, index) => ({
    id:'task-' + index, title:'Shared mission', description:'Independent assignment ' + index,
    task_group_id:'shared-fixture-group', project_id:'project-0',
    project:{id:'project-0',name:'Verification project',client_id:'client',status:'ACTIVE'},
    status:index < 2 ? 'DONE' : 'IN_PROGRESS', priority:'LOW', assigned_to_id:'member-' + index,
    assigned_member:{id:'member-' + index,name:'Member ' + index,avatar_url:null},
    created_by_id:'task-reviewer', created_at:'2026-11-01T06:00:00Z', updated_at:'2026-11-01T06:00:00Z',
    due_at:'2026-12-10T12:00:00Z', total_tracked_seconds:3660 + index * 60,
    can_edit:index !== 4, can_manage_subtasks:index !== 4, can_review_subtasks:false,
    subtasks:[], attachments:['/api/media/assignment-' + index + '.pdf'], tags:[],
  }));
  assignments[18].assigned_to_id = 'former-member-18';
  assignments[18].assigned_member = null;
  assignments[18].assignee = {id:'former-member-18',name:'Former member 18',avatar_url:null};
  const unrelated = {...assignments[0],id:'unrelated',task_group_id:'different-task',assigned_to_id:'task-reviewer'};
  const visible = () => assignments.filter(item => !restricted || item.id === 'task-3').slice(0,visibleCount);
  const count = pattern => requests.filter(item => pattern.test(item.path)).length;
  await page.routeWebSocket('**/api/ws/**', socket => socket.close({code:1000}));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__assignee-avatar.svg') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="#087f8c"/><circle cx="16" cy="12" r="6" fill="#fff"/><path d="M5 30a11 11 0 0122 0" fill="#fff"/></svg>'});
    if (url.pathname === '/__group-navigation') {
      const response = await route.fetch({url:base + '/'});
      return route.fulfill({response,body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"')});
    }
    if (url.pathname === '/api/navigation') return route.fulfill({json:{revision:0,actorRole:restricted?'user':'owner',
      canManageGlobal:!restricted,canManagePersonal:true,oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],
      pages:manifest.map(p => ({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:p.permittedRoles.includes(restricted?'user':'owner')?'allowed':'forbidden'}))}});
    if (url.pathname.startsWith('/api/')) requests.push({path:url.pathname,method:req.method(),query:Object.fromEntries(url.searchParams),body:req.postData()});
    if (url.pathname === '/api/tasks/page') {
      const members = visible();
      const groups = [{...members[0],group_assignments:members}, ...(!restricted ? [{...unrelated,group_assignments:[unrelated]}] : [])];
      return route.fulfill({json:{items:groups,page:1,page_size:50,total:groups.length,total_pages:1,status_counts:{IN_PROGRESS:groups.length},has_more:false}});
    }
    if (/^\/api\/tasks\/[^/]+\/group$/.test(url.pathname)) {
      if (failGroup) return route.fulfill({status:503,json:{detail:'Synthetic group outage'}});
      if (deferGroup) { deferGroup = false; await new Promise(resolve => { releaseGroup = resolve; }); }
      return route.fulfill({json:emptyGroup ? [] : visible()});
    }
    if (/^\/api\/tasks\/[^/]+\/subtasks$/.test(url.pathname) && req.method() === 'POST') {
      const id = url.pathname.split('/')[3], row = assignments.find(item => item.id === id), body = req.postDataJSON();
      row.subtasks.push({id:'subtask-' + id,title:body.title,assigned_to_id:body.assigned_to_id,status:'TODO',completed:false,sort_order:0,dependencies:[],total_tracked_seconds:0});
      return route.fulfill({json:row});
    }
    if (/^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1), row = [...visible(), ...(!restricted ? [unrelated] : [])].find(item => item.id === id);
      if (!row) return route.fulfill({status:403,json:{detail:'Forbidden assignment'}});
      if (req.method() === 'GET' && deferredTask === id) {
        deferredTask = null;
        const snapshot = JSON.parse(JSON.stringify(row));
        await new Promise(resolve => { releaseTask = resolve; });
        return route.fulfill({json:snapshot});
      }
      if (req.method() === 'PATCH') {
        if (denyUpdate) { denyUpdate = false; return route.fulfill({status:409,json:{detail:'Synthetic transition rejected'}}); }
        Object.assign(row,req.postDataJSON());
      }
      return route.fulfill({json:row});
    }
    if (url.pathname.startsWith('/api/comments/task/')) return route.fulfill({json:comments.get(url.pathname.split('/').at(-1)) || []});
    if (url.pathname === '/api/comments' && req.method() === 'POST') {
      const comment = {...req.postDataJSON(),id:'comment-one',created_at:'2026-11-14T10:00:00Z'};
      comments.set(comment.task_id,[...(comments.get(comment.task_id) || []),comment]);
      return route.fulfill({json:comment});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:[]});
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  const go = async (extra = '') => {
    await page.goto(base + '/__group-navigation?multiAssignee=1&partyAvatars=1&networkTaskPage=1&networkParty=1&networkAssignmentDetails=1&rows=24' + extra + '#/tasks');
    await page.locator('[data-task-card-id]').first().waitFor();
  };
  await go();
  await page.getByRole('button',{name:/List/i,exact:true}).click();
  // A single assignment goes directly to fresh details in both All Tasks views.
  for (const view of ['List', 'Grid']) {
    await page.getByRole('button',{name:new RegExp(view,'i'),exact:true}).click();
    const soloCard = page.locator('[data-task-card-id="unrelated"]');
    check(await soloCard.getByText('1 task',{exact:true}).count() === 1 && await soloCard.getByText('View task',{exact:false}).count() === 1, view + ' labels the single assignment as one task');
    const groupReads = count(/\/group$/), pageReads = count(/\/tasks\/page$/), detailReads = count(/\/tasks\/unrelated$/);
    await soloCard.getByRole('button',{name:'Shared mission',exact:true}).click();
    const soloDetail = page.getByRole('dialog',{name:'Quest details'});
    await soloDetail.waitFor();
    await soloDetail.getByLabel('Status',{exact:true}).waitFor();
    check(await page.getByRole('list',{name:'Task assignments'}).count() === 0 && await soloDetail.getByRole('button',{name:'Back to assignments',exact:true}).count() === 0, view + ' opens single-assignee details without a picker or Back step');
    check(count(/\/tasks\/unrelated$/) === detailReads + 1 && count(/\/group$/) === groupReads, view + ' loads the single task once without a group request');
    check(await soloDetail.getByRole('region',{name:'Quest Party',exact:true}).count() === 0, view + ' keeps the assigned-members sidebar hidden');
    if (view === 'List') {
      await soloDetail.locator('select').filter({has:page.locator('option[value="URGENT"]')}).selectOption('HIGH');
      await Promise.all([
        page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/tasks/unrelated')),
        soloDetail.getByRole('button',{name:'Update Task',exact:true}).click(),
      ]);
      check(unrelated.priority === 'HIGH' && assignments.every(row => row.priority === 'LOW'), 'direct solo detail updates only its own assignment');
    }
    await soloDetail.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    check(count(/\/tasks\/page$/) === pageReads && await soloCard.getByRole('button',{name:'Shared mission',exact:true}).evaluate(el => el === document.activeElement), view + ' Close preserves the original card and returns focus without reloading');
    check(await soloCard.getByText(/^High$/i).count() === 1, view + ' card retains the confirmed solo assignment update');
  }
  await page.getByRole('button',{name:/List/i,exact:true}).click();
  const card = page.locator('[data-task-group-key]').filter({hasText:'24 assignments'});
  check(await page.locator('[data-task-card-id]').count() === 2, 'same-title tasks keep separate logical cards');
  check((await card.innerText()).includes('24 assignments') && (await card.innerText()).includes('8% complete'), 'group card shows assignment count and independent progress');
  check((await card.innerText()).includes('22 In Progress') && (await card.innerText()).includes('2 Conquered'), 'group card has a compact status summary');
  check((await card.innerText()).includes('Verification project') && (await card.innerText()).includes('LOW'), 'group card retains project and priority');
  const roster = card.getByRole('group',{name:'Assigned members',exact:true});
  check(await roster.getByRole('img').count() === 5 && (await card.innerText()).includes('24 assigned members'), 'List shows four member avatars and a bounded overflow count');
  await roster.locator('img').first().waitFor();
  check(await roster.locator('img').first().evaluate(img => img.complete && img.naturalWidth > 0), 'List renders the actual assigned-user image');
  check(await roster.getByRole('img',{name:"Member 2's avatar",exact:true}).innerText() === 'M2', 'missing profile images use readable initials');
  await card.screenshot({path:'.tmp/assignee-avatar-list-desktop.png'});
  await page.getByPlaceholder('Search Tasks').fill('Shared');
  await page.waitForResponse(response => response.url().includes('/api/tasks/page') && response.url().includes('search=Shared'));
  await card.waitFor();
  await page.getByRole('button',{name:'All Priorities',exact:true}).click();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/tasks/page') && response.url().includes('priority=LOW')),
    page.getByRole('listbox',{name:'All Priorities',exact:true}).getByRole('option',{name:'LOW',exact:true}).click(),
  ]);
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/tasks/page') && response.url().includes('priority=LOW')),
    page.getByRole('button',{name:/Grid/i,exact:true}).click(),
  ]);
  await card.waitFor();
  check(await roster.getByRole('img').count() === 7 && await roster.getByRole('img',{name:'18 more members',exact:true}).count() === 1, 'Grid shows six overlapping avatars with the remaining member count');
  await card.screenshot({path:'.tmp/assignee-avatar-grid-desktop.png'});
  await page.getByRole('button',{name:/List/i,exact:true}).click();
  await card.waitFor();
  const captureScroll = () => page.evaluate(() => [...document.querySelectorAll('[data-task-group-key]')].filter(card => JSON.parse(card.dataset.taskGroupKey)[1] === 'shared-fixture-group').flatMap(card => {
    const positions = [];
    for (let element = card.parentElement; element; element = element.parentElement) if (element.scrollHeight > element.clientHeight) positions.push(element.scrollTop);
    return positions;
  }));
  await card.scrollIntoViewIfNeeded();
  const originalScroll = await captureScroll();
  const pagesBefore = count(/\/tasks\/page$/);
  deferGroup = true;
  await roster.getByRole('img',{name:"Member 0's avatar",exact:true}).click();
  await page.getByRole('status',{name:'Loading assignments'}).waitFor();
  check(await page.getByRole('dialog',{name:'Quest details'}).count() === 0, 'card opens assignment panel before task details');
  check(await page.locator('[data-assignment-id]').count() === 0, 'loading waits for authorized rows instead of showing cached assignments');
  releaseGroup();
  const list = page.getByRole('list',{name:'Task assignments'});
  await list.waitFor();
  if (!await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    check(await page.locator('.assignment-panel').evaluate(el => getComputedStyle(el).transitionDuration.includes('0.18s')), 'normal-motion navigation uses a subtle 180ms transition');
  }
  check(await list.getByRole('button').count() === 24, 'each visible assignment has its own row');
  check(await page.getByRole('region',{name:'Quest party summary'}).count() === 1 && await page.getByRole('progressbar',{name:'Quest party progress'}).getAttribute('value') === '2', 'gamified picker shows real party progress without merging assignment statuses');
  await page.locator('.assignment-panel').screenshot({path:'.tmp/quest-party-picker-desktop.png'});
  const row = id => list.locator(`[data-assignment-id="${id}"]`);
  check((await row('task-18').innerText()).includes('Former member 18') && (await row('task-18').innerText()).includes('1h 19m') && (await row('task-18').innerText()).includes('Due'), 'rows show name, due date, status and tracked time');
  check(await row('task-18').getByRole('img',{name:"Former member 18's avatar"}).count() === 1, 'authorized assignee identity remains available when directory metadata is absent');
  await row('task-18').getByRole('button').scrollIntoViewIfNeeded();
  const scroll = await page.locator('.assignment-list-scroll').evaluate(el => el.scrollTop);
  await row('task-18').getByRole('button').click();
  const detail = page.getByRole('dialog',{name:'Quest details'});
  await detail.waitFor();
  check(await detail.locator('[data-assignment-task-id="task-18"]').count() === 1, 'selected row opens the original assignment ID');
  check(await detail.getByRole('region',{name:'Quest Party',exact:true}).count() === 0 && !(await detail.innerText()).includes('Assigned Members'), 'assigned-members sidebar is removed from this flow');
  check(count(/\/tasks\/task-\d+$/) === 0 && count(/\/group$/) === 1, 'selection reuses the authorized assignment without duplicate detail or group requests');
  check(await detail.getByRole('link',{name:'/api/media/assignment-18.pdf',exact:true}).count() === 1, 'assignment attachments stay independent');
  await detail.getByRole('button',{name:'Back to assignments',exact:true}).click();
  await list.waitFor();
  check(Math.abs(await page.locator('.assignment-list-scroll').evaluate(el => el.scrollTop) - scroll) < 2, 'Back preserves assignment-list scroll');
  check(await row('task-18').getByRole('button').evaluate(el => el === document.activeElement), 'Back returns keyboard focus to selected row');
  await row('task-3').getByRole('button').click();
  await detail.waitFor();
  const status = detail.getByLabel('Status',{exact:true});
  await status.selectOption('TODO');
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/tasks/task-3')),
    detail.getByRole('button',{name:'Update Task',exact:true}).click(),
  ]);
  await detail.getByRole('button',{name:'Back to assignments',exact:true}).click();
  await row('task-3').getByText('Case Filed',{exact:true}).waitFor();
  check((await row('task-5').innerText()).includes('In Progress'), 'confirmed status change updates only selected assignment');
  check(count(/\/group$/) === 1 && count(/\/tasks\/page$/) === pagesBefore, 'assignment update avoids group and page reloads');
  // Two invalidations for one visible assignment coalesce into one authorized request.
  assignments[5].status = 'ON_HOLD';
  const detailRequests = count(/\/tasks\/task-\d+$/);
  await page.evaluate(async () => {
    const {publishTaskRealtime} = await import('/services/taskRealtimeEvents.ts');
    const notice = {userId:'task-reviewer',tenantId:'task-fixture',payload:{type:'task.updated',task_id:'task-5'}};
    publishTaskRealtime(notice); publishTaskRealtime(notice);
  });
  await row('task-5').getByText('On Hold',{exact:true}).waitFor();
  check(count(/\/tasks\/task-\d+$/) === detailRequests + 1, 'realtime requests coalesce and fetch only affected assignment');
  assignments[5].status = 'TODO'; deferredTask = 'task-5';
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5','TODO'));
  await wait(() => !!releaseTask);
  assignments[5].status = 'ON_HOLD';
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5','ON_HOLD'));
  await page.waitForTimeout(200);
  releaseTask(); releaseTask = null;
  await page.waitForResponse(response => response.url().endsWith('/api/tasks/task-5'));
  await row('task-5').getByText('On Hold',{exact:true}).waitFor();
  await wait(() => count(/\/tasks\/task-5$/) === 3);
  check(count(/\/tasks\/task-5$/) === 3, 'in-flight changes schedule one follow-up request and cannot restore an older status');
  await row('task-3').getByRole('button').click();
  await detail.waitFor();
  assignments[3].total_tracked_seconds = 7500;
  await page.evaluate(() => window.dispatchEvent(new Event('zea:work-updated')));
  await detail.getByText('Tracked 2h 5m',{exact:true}).waitFor();
  check(count(/\/group$/) === 1 && count(/\/tasks\/page$/) === pagesBefore, 'timer changes refresh only the selected assignment');
  await detail.getByLabel('Task comment',{exact:true}).fill('Assignment-specific comment');
  await detail.getByRole('button',{name:'Send transmission',exact:true}).click();
  await detail.getByText('Assignment-specific comment',{exact:true}).waitFor();
  check(JSON.parse(requests.find(req => req.path === '/api/comments' && req.method === 'POST').body).task_id === 'task-3', 'comments retain the selected assignment ID');
  const taskReadsBeforeComment = count(/\/tasks\/task-\d+$/);
  comments.get('task-3').push({id:'external-comment',task_id:'task-3',user_id:'member-3',content:'External assignment comment',created_at:'2026-11-14T10:01:00Z'});
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime',{detail:{userId:'task-reviewer',tenantId:'task-fixture',payload:{type:'comment.created',taskId:'task-3'}}})));
  await detail.getByText('External assignment comment',{exact:true}).waitFor();
  check(count(/\/tasks\/task-\d+$/) === taskReadsBeforeComment && count(/\/group$/) === 1, 'live comments refresh the selected comment list without task or group reloads');
  await detail.getByRole('button',{name:'Add subtask',exact:true}).click();
  await detail.getByLabel('Subtask title',{exact:true}).fill('Selected assignment subtask');
  await detail.getByRole('button',{name:'Add subtask',exact:true}).last().click();
  await detail.getByText('Selected assignment subtask',{exact:true}).waitFor();
  check(assignments[3].subtasks.length === 1 && assignments[5].subtasks.length === 0, 'subtasks remain independent after navigation');
  denyUpdate = true;
  await status.selectOption('IN_REVIEW');
  await detail.getByRole('button',{name:'Update Task',exact:true}).click();
  await page.getByText('Synthetic transition rejected',{exact:true}).waitFor();
  page.once('dialog', dialog => dialog.dismiss());
  await detail.getByRole('button',{name:'Back to assignments',exact:true}).click();
  check(await detail.isVisible(), 'Back protects an unsaved status draft after a rejected update');
  page.once('dialog', dialog => dialog.accept());
  await detail.getByRole('button',{name:'Back to assignments',exact:true}).click();
  await row('task-3').getByText('Case Filed',{exact:true}).waitFor();
  check((await row('task-3').innerText()).includes('2h 5m'), 'Back shows confirmed tracked time and preserves the last accepted status');
  await row('task-3').getByRole('button').click();
  await detail.waitFor();
  const groupsBeforeLog = count(/\/group$/);
  await detail.getByRole('button',{name:'24 users',exact:true}).click();
  const log = page.getByRole('dialog',{name:'Shared task log',exact:true});
  await log.getByText('Team roster',{exact:true}).waitFor();
  check(count(/\/group$/) === groupsBeforeLog + 1, 'existing shared-task log reuses its fresh result without a duplicate group request');
  restricted = true;
  await log.getByRole('button',{name:'Refresh',exact:true}).click();
  await log.getByText(/1 users/).waitFor();
  check(!(await log.innerText()).includes('Member 5'), 'shared log refresh removes assignments whose visibility was revoked');
  restricted = false;
  await log.getByRole('button',{name:'Refresh',exact:true}).click();
  await log.getByText(/24 users/).waitFor();
  await log.getByRole('button',{name:'Close modal',exact:true}).click();
  await detail.getByRole('button',{name:'Back to assignments',exact:true}).click();
  await row('task-4').getByRole('button').click();
  await detail.waitFor();
  check(await detail.getByLabel('Status',{exact:true}).isDisabled() && await detail.getByRole('button',{name:'Delete Task',exact:true}).count() === 0, 'server read-only assignment permissions survive selection');
  await detail.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check(await page.getByPlaceholder('Search Tasks').inputValue() === 'Shared' && count(/\/tasks\/page$/) === pagesBefore, 'Close preserves search and avoids page reloads');
  check(await page.getByRole('button',{name:'LOW',exact:true}).count() === 1, 'Close preserves priority filter');
  const restoredScroll = await captureScroll();
  check(JSON.stringify(restoredScroll) === JSON.stringify(originalScroll), `Close preserves original view scroll position (${originalScroll} / ${restoredScroll})`);
  check(await card.getByRole('button',{name:'Shared mission',exact:true}).evaluate(el => el === document.activeElement), 'Close restores card focus after the representative assignment changes');
  await page.getByRole('button',{name:/Grid/i,exact:true}).click();
  await card.waitFor();
  check((await card.innerText()).includes('1 Case Filed') && (await card.innerText()).includes('1 On Hold'), 'Grid receives reconciled assignment statuses');
  check(count(/\/tasks\/page$/) === pagesBefore, 'cached Grid reflects changes without another page request');
  await card.getByRole('button',{name:'Shared mission',exact:true}).click();
  await list.waitFor();
  await page.setViewportSize({width:375,height:850});
  check(await page.locator('.assignment-panel').evaluate(el => el.scrollWidth <= el.clientWidth) && await list.evaluate(el => el.scrollWidth <= el.clientWidth), 'assignment panel and rows fit mobile width');
  await page.locator('.assignment-panel').screenshot({path:'.tmp/quest-party-picker-mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  check(await page.locator('.assignment-panel').evaluate(el => getComputedStyle(el).animationName === 'none' && getComputedStyle(el).transitionDuration === '0s'), 'navigation respects reduced-motion preferences');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  check(await roster.getByRole('img').count() === 5 && await roster.getByRole('img',{name:'20 more members',exact:true}).count() === 1, 'mobile Grid bounds the stack to four avatars and the correct remainder');
  check(await card.evaluate(el => el.scrollWidth <= el.clientWidth), 'avatar row does not overflow the mobile card');
  await card.screenshot({path:'.tmp/assignee-avatar-grid-mobile.png'});
  failGroup = true;
  await card.getByRole('button',{name:'Shared mission',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Unable to load assignments'}).waitFor();
  check(await page.locator('[data-assignment-id]').count() === 0, 'failed authorization refresh exposes no stale rows');
  failGroup = false;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await list.waitFor();
  cases.push('assignment load recovers with explicit retry');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  emptyGroup = true;
  await card.getByRole('button',{name:'Shared mission',exact:true}).click();
  await page.getByText('No visible assignments.',{exact:true}).waitFor();
  cases.push('empty authorized group has an explicit empty state');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  emptyGroup = false;
  restricted = true;
  await go('&account=member-3&role=user&personalAssignment=1');
  const ownRoster = page.locator('[data-task-card-id]').getByRole('group',{name:'Assigned members',exact:true});
  check(await ownRoster.getByRole('img').count() === 1 && await ownRoster.getByRole('img',{name:"Member 3's avatar",exact:true}).count() === 1, 'restricted card shows only its visible assignee avatar');
  await page.locator('[data-task-card-id]').getByRole('button',{name:'Shared mission',exact:true}).click();
  await detail.waitFor();
  check(await page.getByRole('list',{name:'Task assignments'}).count() === 0 && await detail.getByRole('button',{name:'Back to assignments',exact:true}).count() === 0, 'restricted single-assignee view opens details directly');
  check(!(await detail.innerText()).includes('Member 5') && await detail.locator('[data-assignment-task-id="task-3"]').count() === 1, 'restricted detail never restores hidden peer content');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  restricted = false; visibleCount = 2;
  await page.setViewportSize({width:1440,height:1000});
  await go();
  const pairCard = page.locator('[data-task-card-id="task-0"]');
  await pairCard.getByRole('button',{name:'Shared mission',exact:true}).click();
  await list.waitFor();
  check(await list.getByRole('button').count() === 2, 'two visible assignees open the picker instead of either assignment directly');
  check(await page.locator('.assignment-panel').evaluate(el => el.clientHeight < 650), 'small party picker fits its content without a large empty panel');
  await page.locator('.assignment-panel').screenshot({path:'.tmp/quest-party-picker-small.png'});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  check(errors.length === 0, 'no browser rendering errors');
  page.off('pageerror',onError);
  const result = {passed:cases.length,cases};
  await page.evaluate(result => { window.groupedTaskNavigationResult = result; }, result);
  return result;
}
