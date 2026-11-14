// UI contract checks with synthetic, server-filtered Kanban HTTP responses.
async (page) => {
  await page.goto('about:blank');
  await page.unrouteAll({behavior:'wait'});
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const statuses = ['IN_PROGRESS', 'DONE'].map((status, index) => ({
    id: 'stage-' + index, status, legacy_status: status, title: index ? 'Completed' : 'In Progress',
    display_label: index ? 'Completed' : 'In Progress', order: index, sort_order: index,
    color: '#6366f1', icon: 'default', is_system: true, is_active: true, kanban_visible: true,
  }));
  const assignment = (id, name, status, group = 'shared-task') => ({
    id, title: 'Shared mission', task_group_id: group, status, priority: 'MEDIUM',
    assigned_to_id: 'user-' + id, assigned_member: { id: 'user-' + id, name, avatar_url: null },
    created_by_id: 'kanban-reviewer', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
    can_edit: true, subtasks: [], attachments: [], tags: [],
  });
  const active = assignment('active', 'Alex Active', 'IN_PROGRESS');
  const completed = [assignment('done-1', 'Blair Completed', 'DONE'), assignment('done-2', 'Casey Completed', 'DONE')];
  const other = assignment('other', 'Different task member', 'DONE', 'different-task');
  let cards = [{...active, group_assignments: [active]}, {...completed[0], group_assignments: completed}, {...other, group_assignments: [other]}];
  const opened = [], errors = [], cases = [];
  const check = (condition, message) => { if (!condition) throw Error(message); cases.push(message); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.routeWebSocket('**/api/ws/**', socket => socket.close({code:1000}));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__kanban-stages') {
      const response = await route.fetch({url:base + '/'});
      return route.fulfill({response, body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/settingsNavigationFixture.tsx"')});
    }
    if (url.pathname === '/api/navigation') return route.fulfill({json:{
      revision:0, actorRole:'owner', canManageGlobal:true, canManagePersonal:true,
      oauthManagementAccess:'allowed', roles:['owner','admin','manager','user'], apiSections:[],
      pages:manifest.map(p => ({...p, enabled:true, hidden:false, allowedRoles:p.permittedRoles,
        access:p.permittedRoles.includes('owner') ? 'allowed' : 'forbidden'})),
    }});
    if (url.pathname === '/api/kanban-columns') return route.fulfill({json:statuses});
    if (url.pathname === '/api/tasks/kanban') return route.fulfill({json:{configuration_revision:1,
      columns:statuses.map(row => ({...row, status_id:row.id,
        items:cards.filter(card => card.status === row.status), count:cards.filter(card => card.status === row.status).length})),
      outside_columns:[], unmapped_count:0, unmapped_items:[],
    }});
    if (/^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1);
      opened.push(id);
      return route.fulfill({json:[active, ...completed, other].find(row => row.id === id)});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:[]});
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base + '/__kanban-stages?role=owner&tenant=kanban-fixture&account=kanban-reviewer&kanban=live&business=live#/tasks/kanban');
  const panel = page.locator('#tasks-panel-kanban');
  const done = panel.locator('[data-task-id="done-1"]');
  await done.waitFor();
  check(await panel.locator('[data-task-status="IN_PROGRESS"] [data-task-id]').count() === 1, 'one task card in In Progress');
  check(await panel.locator('[data-task-status="DONE"] [data-task-id]').count() === 2, 'different tasks with the same title remain separate Completed cards');
  check((await done.textContent()).includes('Blair Completed, Casey Completed') && !(await done.textContent()).includes('Alex Active'), 'card shows only same-stage assignees');
  const stageRoster = done.getByRole('group',{name:'Assigned members',exact:true});
  check(await stageRoster.getByRole('img').count() === 2 && await stageRoster.getByRole('img',{name:"Blair Completed's avatar",exact:true}).count() === 1 && await stageRoster.getByRole('img',{name:"Casey Completed's avatar",exact:true}).count() === 1, 'Completed card shows only the two same-stage assignee avatars');
  check(await panel.locator('[data-task-id="active"]').getByRole('img',{name:"Alex Active's avatar",exact:true}).count() === 1, 'single-assignment Kanban card shows its avatar fallback');
  await done.screenshot({path:'.tmp/assignee-avatar-kanban-desktop.png'});
  check(await done.getAttribute('draggable') === 'false', 'grouped card does not move a representative assignment implicitly');
  await done.getByRole('button', {name:'View',exact:true}).click();
  let list = page.getByRole('list', {name:'Stage assignments'});
  await list.waitFor();
  check(await list.getByRole('button').count() === 2, 'Completed card opens a list of two assignments');
  check(!(await list.textContent()).includes('Alex Active') && !(await list.textContent()).includes('Different task member'), 'assignment list excludes other stages and tasks');
  await list.getByRole('button', {name:/Casey Completed/}).click();
  await page.getByRole('dialog', {name:'Quest details'}).waitFor();
  check(opened.at(-1) === 'done-2', 'entry opens its own assignment ID in task details');
  await page.getByRole('button', {name:'Close modal',exact:true}).click();
  await page.getByRole('button', {name:'Close assignments',exact:true}).click();
  await panel.locator('[data-task-id="active"]').click();
  list = page.getByRole('list', {name:'Stage assignments'});
  await list.waitFor();
  check(await list.getByRole('button').count() === 1 && (await list.textContent()).includes('Alex Active'), 'single-assignment card also opens its stage entry list');
  await page.keyboard.press('Escape');
  await list.waitFor({state:'hidden'});
  cases.push('assignment dialog closes with Escape');
  // Simulate the API returning a restricted viewer's own authorized assignment.
  cards = [{...completed[1], group_assignments:[completed[1]]}];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('task-statuses-updated', {detail:{tenantId:'kanban-fixture'}})));
  const own = panel.locator('[data-task-id="done-2"]');
  await own.waitFor();
  check(await own.getByRole('group',{name:'Assigned members',exact:true}).getByRole('img').count() === 1 && await own.getByRole('img',{name:"Casey Completed's avatar",exact:true}).count() === 1, 'restricted Kanban card cannot restore a hidden peer avatar');
  check(!(await panel.textContent()).includes('Blair Completed') && !(await panel.textContent()).includes('Alex Active'), 'restricted response never expands hidden assignments in the card');
  await own.getByRole('button', {name:'View',exact:true}).click();
  list = page.getByRole('list', {name:'Stage assignments'});
  check(await list.getByRole('button').count() === 1 && (await list.textContent()).includes('Casey Completed'), 'restricted assignment list preserves server-filtered membership');
  await page.setViewportSize({width:375,height:850});
  check(await page.getByRole('dialog').evaluate(el => el.querySelector('ul').scrollWidth <= el.clientWidth), 'assignment list fits mobile dialog');
  await page.getByRole('button', {name:'Close assignments',exact:true}).click();
  check(errors.length === 0, 'no browser rendering exceptions');
  page.off('pageerror', onError);
  return {passed:cases.length,cases};
}
