// Actual Tasks page, API mapper, caches, modal and Kanban with synthetic loopback-only data.
async (page) => {
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const cases = [], errors = [], queries = [], partyQueries = [];
  const check = (condition, name) => { if (!condition) throw Error(name); cases.push(name); };
  const wait = async predicate => { const end = Date.now() + 15000; while (!await predicate()) {
    if (Date.now() > end) throw Error('Timed out waiting for task UI'); await new Promise(resolve => setTimeout(resolve, 50));
  } };
  let empty = false, fail = false, paginationMode = false, deferParty = false, releaseParty = null, secondProject = false, deleteBarrier = null;
  const deleted = new Set(), deniedDeletes = new Set(), deleteCalls = [];
  const assignments = Array.from({ length: 8 }, (_, index) => ({
    id: 'task-' + index, title: 'Shared mission', description: 'One mission, independent member assignments.',
    status: index < 2 ? 'DONE' : 'IN_PROGRESS', priority: 'LOW', team: 'Engineering',
    assigned_to_id: 'member-' + index, assigned_member: { id: 'member-' + index, name: 'Member ' + index, avatar_url: null },
    task_group_id: 'shared-fixture-group', project_id: 'project-0',
    project: { id: 'project-0', name: 'Verification project', client_id: 'client', status: 'ACTIVE' },
    created_by_id: 'task-reviewer', created_at: '2026-11-01T06:00:00Z', updated_at: '2026-11-01T06:00:00Z',
    due_at: null, completed_at: index < 2 ? '2026-11-02T06:00:00Z' : null, subtasks: [], attachments: [], tags: [],
  }));
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/api/ws/**', socket => socket.close({ code: 1000 }));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ path: 'docs/push-notifications/checks/tailwind-test-runtime.js', contentType: 'text/javascript' });
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__task-groups') {
      const response = await route.fetch({ url: base + '/' });
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({ json: { revision: 0, actorRole: 'owner', canManageGlobal: true,
      canManagePersonal: true, oauthManagementAccess: 'allowed', roles: ['owner','admin','manager','user'], apiSections: [],
      pages: manifest.map(item => ({ ...item, enabled: true, hidden: false, allowedRoles: item.permittedRoles,
        access: item.permittedRoles.includes('owner') ? 'allowed' : 'forbidden' })) } });
    if (url.pathname === '/api/tasks/page') {
      queries.push(Object.fromEntries(url.searchParams));
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Synthetic task outage' } });
      const available = assignments.filter(item => !deleted.has(item.id));
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 10);
      let groups = paginationMode ? Array.from({ length: pageSize + 1 }, (_, index) => {
        const members = available.map(item => ({ ...item, id: `paged-${index}-${item.id}`, title: 'Paged mission ' + index,
          task_group_id: 'paged-group-' + index }));
        return { ...members.at(-1), group_assignments: members };
      }) : available.length ? [{ ...available.at(-1), group_assignments: available }] : [];
      if (secondProject && available.length) {
        const members = available.map(item => ({ ...item, id: 'other-' + item.id, task_group_id: 'another-group', project_id: 'project-1', project: { ...item.project, id: 'project-1', name: 'Another project' } }));
        groups.push({ ...members.at(-1), group_assignments: members });
      }
      const matches = item => (!url.searchParams.get('search') || item.title.toLowerCase().includes(url.searchParams.get('search').toLowerCase()))
        && (!url.searchParams.get('status') || item.status === url.searchParams.get('status'))
        && (!url.searchParams.get('priority') || item.priority === url.searchParams.get('priority'))
        && (!url.searchParams.get('assignee_id') || item.assigned_to_id === url.searchParams.get('assignee_id'))
        && (!url.searchParams.get('project_id') || item.project_id === url.searchParams.get('project_id'));
      groups = groups.flatMap(group => { const candidates = group.group_assignments.filter(matches); return candidates.length ? [{ ...candidates.at(-1), group_assignments: group.group_assignments }] : []; });
      const matching = empty ? [] : groups;
      const items = url.searchParams.get('grouped') === 'true'
        ? matching.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
        : matching.flatMap(group => group.group_assignments);
      return route.fulfill({ json: { items, page: pageNumber, page_size: pageSize, total: matching.length,
        total_pages: Math.max(1, Math.ceil(matching.length / pageSize)),
        status_counts: matching.length ? { IN_PROGRESS: matching.length } : {},
        has_more: pageNumber * pageSize < matching.length, next_cursor: null } });
    }
    if (/^\/api\/tasks\/[^/]+\/group$/.test(url.pathname)) {
      partyQueries.push(url.pathname);
      const json = assignments.map(item => ({ ...item, can_edit: true }));
      if (deferParty) {
        deferParty = false;
        await new Promise(resolve => { releaseParty = async () => { await route.fulfill({ json }); resolve(); }; });
        return;
      }
      return route.fulfill({ json });
    }
    if (url.pathname.startsWith('/api/tasks/') && route.request().method() === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      deleteCalls.push(id);
      if (deleteBarrier) await deleteBarrier;
      if (deniedDeletes.has(id)) return route.fulfill({ status: 403, json: { detail: 'Synthetic assignment forbidden' } });
      deleted.add(id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.endsWith('/websocket-ticket') ? { access_token: 'synthetic-ticket' } : [] });
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let run = 0;
  const go = (extra = '') => page.goto(base + '/__task-groups?multiAssignee=1&networkTaskPage=1&rows=8&run=' + (++run) + extra + '#/tasks');
  await go();
  await page.locator('[data-task-card-id]').first().waitFor();
  check(await page.locator('[data-task-card-id]').count() === 1, 'List renders one logical task for eight members');
  check(queries.every(query => query.grouped === 'true'), 'List API opts in to server grouping');
  const card = page.locator('[data-task-card-id]');
  check(await card.getByText('8 assigned members', { exact: true }).count() === 1, 'List shows member count');
  check((await card.boundingBox()).height <= 260, 'Desktop grouped list stays compact');
  await card.screenshot({ path: '.tmp/group-quest-list.png' });
  check(await card.locator('[role="img"][aria-label$="avatar"]').count() === 6 && await card.getByLabel('2 more members').count() === 1, 'Six avatars plus +2 overflow');
  check(await card.getByText('25% (2/8 complete)', { exact: true }).count() === 1, 'Overall progress reflects all member assignments');
  await card.getByText('View 8 assignments', { exact: true }).click();
  check(await card.getByRole('button', { name: /^Open assignment for Member/ }).count() === 8, 'Every member assignment is individually accessible');
  await card.getByRole('button', { name: 'Open assignment for Member 3', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete Task', exact: true }).waitFor();
  await wait(() => page.evaluate(() => window.taskNavigationAudit.calls.some(call => call.method === 'getTask' && call.args[0] === 'task-3')));
  check(true, 'Keyboard activation opens the original member assignment ID');
  const party = page.getByRole('region', { name: 'Quest Party', exact: true });
  await party.locator('[data-party-assignment-id]').first().waitFor();
  check(await party.locator('[data-party-assignment-id]').count() === 8, 'Quest Party exposes eight original member assignments');
  check(await party.getByText(/^XP estimate:/).count() === 8, 'Each party member retains an independent XP presentation');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.questPointsReads = 0; const original = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (key === 'task-points-config') window.questPointsReads++; return original.call(this, key); }; });
  const callsBeforeDraft = await page.evaluate(() => window.taskNavigationAudit.calls.length);
  await page.getByLabel('Task comment', { exact: true }).fill('An unsaved comment');
  check(await page.evaluate(() => window.questPointsReads) === 0, 'Comment typing does not recalculate the unchanged party rewards');
  check(await page.evaluate(() => window.taskNavigationAudit.calls.length) === callsBeforeDraft, 'Comment typing does not issue task or party requests');
  await page.getByLabel('Task comment', { exact: true }).fill('');
  await party.getByRole('heading', { name: 'Quest Party', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('dialog', { name: 'Quest details', exact: true }).locator('main').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '.tmp/group-quest-details.png' });

  await page.getByRole('button', { name: '8 users', exact: true }).click();
  const sharedLog = page.getByRole('dialog', { name: 'Shared task log', exact: true });
  await sharedLog.getByRole('heading', { name: 'Shared Task Group', exact: true }).waitFor();
  await sharedLog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await sharedLog.getByRole('button', { name: 'Close modal', exact: true }).click();
  await page.getByRole('dialog', { name: 'Quest details', exact: true }).waitFor();
  check(true, 'Existing shared-task log refresh and close actions remain usable inside quest details');

  await party.getByRole('button', { name: 'Manage assignment for Member 4', exact: true }).click();
  const status = page.getByLabel('Status', { exact: true });
  await status.waitFor();
  await wait(() => page.evaluate(() => window.taskNavigationAudit.calls.some(call => call.method === 'getTask' && call.args[0] === 'task-4')));
  await status.selectOption('TODO');
  await page.getByRole('button', { name: 'Update Task', exact: true }).click();
  await wait(() => page.evaluate(() => window.taskNavigationAudit.calls.some(call => call.method === 'updateTask' && call.args[0] === 'task-4' && call.args[1].status === 'TODO')));
  const member4 = party.locator('[data-party-assignment-id="task-4"]');
  await wait(async () => (await member4.innerText()).includes('Case Filed'));
  check((await member4.innerText()).includes('XP estimate: Potential points: +10'), 'Assignment XP matches the task data used by the grouped card');
  check((await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('In Progress'), 'Confirmed update refreshes the chosen member while sibling status remains independent');
  await page.evaluate(() => window.taskNavigationAudit.rejectNextUpdate());
  await status.selectOption('IN_REVIEW');
  await page.getByRole('button', { name: 'Update Task', exact: true }).click();
  await page.getByText('Synthetic transition rejected', { exact: true }).waitFor();
  check((await member4.innerText()).includes('Case Filed'), 'Rejected mutation never displays an unconfirmed member status');
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5', 'ON_HOLD'));
  await wait(async () => (await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('On Hold'));
  check(true, 'Realtime changes to another visible member refresh the Quest Party');
  page.once('dialog', dialog => dialog.dismiss());
  await party.getByRole('button', { name: 'Manage assignment for Member 6', exact: true }).click();
  check((await member4.innerText()).includes('Current assignment'), 'Switching member assignments protects unsaved status changes');
  page.once('dialog', dialog => dialog.accept());
  await party.getByRole('button', { name: 'Manage assignment for Member 6', exact: true }).click();
  await wait(async () => (await party.locator('[data-party-assignment-id="task-6"]').innerText()).includes('Current assignment'));
  await wait(() => status.evaluate(element => element === document.activeElement));
  check(true, 'Accepted member switch focuses the canonical status control');
  await page.getByRole('dialog', { name: 'Quest details', exact: true }).getByRole('button', { name: 'Close modal', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'Keyboard focus stays inside quest details');

  await party.locator('[data-party-assignment-id="task-4"]').screenshot({ path: '.tmp/group-quest-party-member.png' });

  await go(); await page.locator('[data-task-card-id]').first().waitFor();

  await page.evaluate(() => { window.questPointsReads = 0; const original = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (key === 'task-points-config') window.questPointsReads++; return original.call(this, key); }; });
  await card.getByRole('checkbox').check();
  check(await page.evaluate(() => window.questPointsReads) === 0, 'Selection does not recompute unchanged Group Quest rewards');
  check(await page.getByRole('button', { name: 'Delete Selected (8)', exact: true }).count() === 1, 'Group selection retains all eight assignment IDs');
  assignments.push({ ...assignments[7], id: 'extra-task', assigned_to_id: 'extra-member', assigned_member: { id: 'extra-member', name: 'Extra member', avatar_url: null } });
  await page.evaluate(() => window.taskNavigationAudit.changed());
  await card.getByText('9 assigned members', { exact: true }).waitFor();
  check(await card.getByRole('checkbox').evaluate(element => element.indeterminate), 'New party membership exposes a mixed selection to assistive technology');
  await card.getByRole('checkbox').click();
  check(await page.getByRole('button', { name: 'Delete Selected (9)', exact: true }).count() === 1, 'Selecting a mixed group adds only its newly visible assignment');
  assignments.pop();
  await go(); await card.first().waitFor();
  await card.getByRole('checkbox').check();

  await page.getByRole('button', { name: /Grid/i, exact: true }).click();
  await wait(async () => await page.locator('[data-task-card-id]').count() === 1);
  check(await card.getByText('8 assigned members', { exact: true }).count() === 1, 'Grid renders one card with all members');
  check(await card.getByText('Group Quest', { exact: true }).count() === 1 && await card.getByLabel('Overall status: Mixed statuses').count() === 1, 'Group card shows party identity and an honest aggregate status');
  const avatarTrigger = card.locator('.quest-avatar-stack [tabindex="0"]').first();
  await avatarTrigger.focus();
  await page.getByRole('tooltip', { name: 'Member 0', exact: true }).waitFor();
  check(true, 'Member-name tooltip is keyboard accessible');
  await page.evaluate(async () => { const { publishProfile } = await import('/services/profileEvents.ts'); publishProfile({ id: 'member-0', tenantId: 'task-fixture', name: 'Live renamed member', role: 'user', avatarUrl: null }); });
  await page.getByRole('tooltip', { name: 'Live renamed member', exact: true }).waitFor();
  check(await card.getByLabel("Live renamed member's avatar").count() === 1, 'Profile events keep the avatar and member tooltip names synchronized');
  await card.getByText('View 8 assignments', { exact: true }).click();
  check(await card.getByRole('button', { name: 'Open assignment for Live renamed member', exact: true }).count() === 1, 'Live profile names also update member actions');
  await card.getByText('View 8 assignments', { exact: true }).click();
  await page.evaluate(async () => { const { publishProfile } = await import('/services/profileEvents.ts'); publishProfile({ id: 'member-0', tenantId: 'task-fixture', name: 'Member 0', role: 'user', avatarUrl: null }); });
  await avatarTrigger.evaluate(element => element.blur());
  await avatarTrigger.hover();
  await page.getByRole('tooltip', { name: 'Member 0', exact: true }).hover();
  await page.waitForTimeout(200);
  check(await page.getByRole('tooltip', { name: 'Member 0', exact: true }).isVisible(), 'Member tooltips remain readable when hovered');

  await page.keyboard.press('Escape');
  await wait(async () => await page.getByRole('tooltip').count() === 0);
  check(await card.evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(duration => Number.parseFloat(duration) === 0)), 'Group card respects reduced motion');
  await card.screenshot({ path: '.tmp/group-quest-grid.png' });
  await page.setViewportSize({ width: 768, height: 1024 });
  check((await card.boundingBox()).width <= 768 && await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Group card fits tablet viewport without overflow');

  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  check(box.width <= 390, 'Grouped card fits compact viewport');
  check(await card.locator('.quest-avatar-stack [role="img"][aria-label$="avatar"]:visible').count() === 4 && await card.getByLabel('4 more members').isVisible(), 'Compact avatars show four members and accurate overflow');
  check(await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Compact card has no internal horizontal overflow');
  await card.screenshot({ path: '.tmp/group-quest-mobile.png' });

  check(await card.getByRole('progressbar').getAttribute('aria-label') === 'Overall progress for Shared mission', 'Progress has an accessible name');
  assignments.forEach(item => { item.title = 'Long mission ' + 'x'.repeat(220); });
  assignments[0].assigned_member.name = '<script>' + 'x'.repeat(200);
  await go('&longPartyName=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await card.scrollIntoViewIfNeeded();
  check((await card.boundingBox()).width <= 390, 'Long logical titles remain inside compact cards');
  await card.locator('.quest-avatar-stack [tabindex="0"]').first().focus();
  const longTooltip = page.getByRole('tooltip', { name: /^<script>/ });
  await longTooltip.waitFor();
  await wait(async () => { const bounds = await longTooltip.boundingBox(); return bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390; });
  check(true, 'Long member-name tooltips remain inside the compact viewport');
  await page.keyboard.press('Escape');

  await card.getByText('View 8 assignments', { exact: true }).click();
  check(await card.getByRole('button', { name: /^Open assignment for <script>/ }).count() === 1,
    'Long member names remain escaped and accessible');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: 'Kanban Board', exact: true }).click();
  await page.locator('[draggable="true"]').first().waitFor();
  check(await page.locator('[draggable="true"]').count() === 8, 'Kanban retains eight independent assignment cards');
  const before = await page.evaluate(() => window.taskNavigationAudit.calls.filter(call => call.method === 'getTasksPage').length);
  const moving = page.locator('[data-task-status="IN_PROGRESS"] [draggable="true"]').first();
  await page.locator('.kanban-board-scroll').evaluate(element => { element.scrollLeft = 0; });
  await moving.dragTo(page.locator('[data-task-status="TODO"]'), { targetPosition: { x: 100, y: 120 } });
  await wait(() => page.evaluate(() => window.taskNavigationAudit.calls.some(call => call.method === 'moveTaskToKanbanStatus' && call.args[0] === 'task-2' && call.args[1] === 'fixture-status-TODO')));
  check(await page.locator('[draggable="true"]').count() === 8, 'Kanban drag moves one assignment without grouping or losing cards');
  check(await page.evaluate(() => window.taskNavigationAudit.calls.filter(call => call.method === 'getTasksPage').length) === before, 'Kanban never requests grouped task retrieval');

  assignments.forEach(item => { item.title = 'Shared mission'; });
  assignments[0].assigned_member.name = 'Member 0';
  await go('&readOnlyParty=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await party.locator('[data-party-assignment-id]').first().waitFor();
  check(await party.getByRole('button', { name: /^Manage assignment/ }).count() === 0 && await party.getByRole('button', { name: /^View assignment/ }).count() === 8, 'Server read-only permissions suppress all member management actions');
  check(await page.getByLabel('Status', { exact: true }).isDisabled(), 'Read-only member status editor remains disabled');
  await go('&memberPermissions=1'); await card.first().waitFor();
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await party.locator('[data-party-assignment-id]').first().waitFor();
  check(await party.getByRole('button', { name: /^Manage assignment/ }).count() === 1 && await party.getByRole('button', { name: /^View assignment/ }).count() === 7, 'Each member uses its own backend edit capability');
  await party.getByRole('button', { name: 'Manage assignment for Member 3', exact: true }).click();
  await wait(async () => !await page.getByLabel('Status', { exact: true }).isDisabled());
  check(true, 'Permitted member opens an enabled editor independently of the representative permission');

  await go('&partyError=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await party.getByRole('alert').waitFor();
  check(await party.getByRole('button', { name: 'Retry party', exact: true }).count() === 1, 'Quest Party failures have an accessible retry action');
  await go('&emptyParty=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await party.getByText('No visible member assignments.', { exact: true }).waitFor();
  check(true, 'Empty Quest Party is explicit');
  await go('&partyDelay=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await party.getByRole('status').waitFor();
  check(true, 'Quest Party announces loading');
  await wait(async () => await party.locator('[data-party-assignment-id]').count() === 8);
  await page.setViewportSize({ width: 390, height: 844 });
  check(await party.evaluate(element => element.scrollWidth <= element.clientWidth), 'Quest Party fits the compact details sidebar');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await go('&networkParty=1'); await page.locator('[data-task-card-id]').first().waitFor();
  await page.evaluate(() => window.taskNavigationAudit.rawTaskGroup('task-7'));
  const beforeParty = partyQueries.length;
  assignments[5].status = 'ON_HOLD';
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  await wait(async () => await party.locator('[data-party-assignment-id]').count() === 8);
  check(partyQueries.length > beforeParty && (await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('On Hold'), 'Party loading bypasses a populated stale group cache using the real API mapper');
  await page.waitForTimeout(500);
  const beforeDetailReads = await page.evaluate(() => window.taskNavigationAudit.calls.filter(call => ['getTask', 'getComments'].includes(call.method)).length);
  const beforeRealtime = partyQueries.length;
  const beforeListRefresh = queries.length;
  await page.getByLabel('Status', { exact: true }).selectOption('IN_REVIEW');
  assignments[5].status = 'TODO';
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5', 'TODO'));
  await wait(async () => partyQueries.length > beforeRealtime && (await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('Case Filed'));
  check(true, 'Realtime party refresh bypasses cached group data');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.taskNavigationAudit.calls.filter(call => ['getTask', 'getComments'].includes(call.method)).length) === beforeDetailReads, 'Another member update refreshes the group without rereading the open task and comments');

  await wait(() => queries.length > beforeListRefresh);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check(await page.getByLabel('Status', { exact: true }).inputValue() === 'IN_REVIEW', 'Background list refresh preserves an unsaved assignment status draft');
  const beforeDeferred = partyQueries.length;
  deferParty = true;
  assignments[5].status = 'ON_HOLD';
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5', 'ON_HOLD'));
  await wait(() => releaseParty !== null);
  assignments[5].status = 'TODO';
  await page.evaluate(() => window.taskNavigationAudit.moveMember('task-5', 'TODO'));
  await wait(async () => partyQueries.length >= beforeDeferred + 2 && await party.getAttribute('aria-busy') === 'false' && (await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('Case Filed'));
  await releaseParty(); releaseParty = null;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check((await party.locator('[data-party-assignment-id="task-5"]').innerText()).includes('Case Filed'), 'Late party responses cannot overwrite a newer member status');
  await page.waitForTimeout(500);
  const beforeForeign = partyQueries.length;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zea:task-realtime', { detail: { userId: 'other-user', tenantId: 'other-tenant', payload: { task_id: 'task-5' } } })));
  await page.waitForTimeout(350);
  check(partyQueries.length === beforeForeign, 'Another tenant or account realtime notice cannot refresh this party');

  assignments[5].status = 'IN_PROGRESS';


  for (const theme of ['light', 'colorful']) {
    await page.evaluate(theme => localStorage.setItem('zenith-task-theme', theme), theme);
    await go(); await page.locator('[data-task-card-id]').first().waitFor();
    await page.getByRole('button', { name: /Grid/i, exact: true }).click();
    await card.getByText('Group Quest', { exact: true }).waitFor();
    check(await page.evaluate(theme => document.documentElement.classList.contains('theme-' + theme), theme) && await card.evaluate(element => element.scrollWidth <= element.clientWidth), 'Group card inherits the existing ' + theme + ' theme without overflow');

    const contrast = await card.locator('.quest-avatar-stack [role="img"][aria-label$="avatar"]').first().evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const text = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    check(contrast >= 4.5, 'Avatar initials meet normal-text contrast in ' + theme + ' theme');
    await card.screenshot({ path: '.tmp/group-quest-' + theme + '.png' });
  }
  await page.evaluate(() => localStorage.setItem('zenith-task-theme', 'dark'));

  const fullParty = assignments.slice();
  for (const size of [1, 4, 5, 6]) {
    assignments.splice(0, assignments.length, ...fullParty.slice(0, size));
    await page.setViewportSize({ width: 390, height: 844 });
    await go(); await card.first().waitFor();
    check(await card.locator('.quest-avatar-stack [role="img"][aria-label$="avatar"]:visible').count() === Math.min(size, 4)
      && (size <= 4 || await card.getByLabel((size - 4) + ' more members').isVisible()), 'Compact avatar boundary is accurate for ' + size + ' members');
  }
  assignments.splice(0, assignments.length, ...fullParty);
  const memberSnapshot = assignments[0].assigned_member;
  assignments[0].assigned_member = null;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go(); await card.first().waitFor();
  check(await card.getByText('8 assigned members', { exact: true }).count() === 1, 'Missing snapshot metadata cannot reduce actual membership');
  await card.locator('.quest-avatar-stack [tabindex="0"]').first().focus();
  await page.getByRole('tooltip', { name: 'Member 0', exact: true }).waitFor();
  check(true, 'Directory fallback uses the same member name for tooltip and avatar');
  await page.keyboard.press('Escape');
  assignments[0].assigned_member = { ...memberSnapshot, name: 'Outdated name' };
  await go(); await card.first().waitFor();
  await card.getByText('View 8 assignments', { exact: true }).click();
  check(await card.getByRole('button', { name: 'Open assignment for Member 0', exact: true }).count() === 1, 'Current directory names replace stale snapshot names in member actions');
  assignments[0].assigned_member = memberSnapshot;
  secondProject = true;
  await go(); await wait(async () => await card.count() === 2);
  check(new Set(await card.evaluateAll(elements => elements.map(element => element.dataset.taskCardId))).size === 2, 'Identical titles in different projects remain distinct logical task cards');
  await page.getByRole('button', { name: /List/i, exact: true }).click();
  check(await card.count() === 2, 'Switching Grid to List does not duplicate or merge equal-title quests');
  const search = page.getByRole('textbox', { name: 'Search tasks', exact: true });
  await search.fill('No matching mission');
  await page.getByRole('heading', { name: 'No tasks found', exact: true }).waitFor();
  check(queries.at(-1).search === 'No matching mission', 'Debounced search preserves server grouping and produces the correct empty result');
  await search.fill('Shared');
  await wait(async () => await card.count() === 2);
  const statusFilter = page.getByRole('button', { name: 'All Statuses', exact: true });
  await statusFilter.focus(); await page.keyboard.press('Enter');
  const options = page.getByRole('listbox', { name: 'All Statuses', exact: true });
  await options.waitFor();
  await page.keyboard.press('ArrowDown');
  await wait(() => page.evaluate(() => document.activeElement.getAttribute('role') === 'option'));
  check(true, 'Status filter supports arrow-key option navigation');
  await options.getByRole('option', { name: 'Conquered', exact: true }).click();
  await wait(() => queries.at(-1).status === 'DONE');
  await wait(async () => await card.count() === 2);
  check(await card.first().getByText('8 assigned members', { exact: true }).count() === 1, 'Status filtering retains all visible members of each matching logical quest');
  check(await page.getByRole('button', { name: 'Conquered', exact: true }).evaluate(element => element === document.activeElement), 'Filter selection returns focus to the trigger');
  const projectFilter = page.getByRole('button', { name: 'All Projects', exact: true });
  await projectFilter.click();
  const projectSearch = page.getByRole('textbox', { name: 'Search project...', exact: true });
  await projectSearch.focus(); await page.keyboard.press('ArrowUp');
  check(await page.getByRole('listbox', { name: 'All Projects', exact: true }).getByRole('option').last().evaluate(element => element === document.activeElement), 'Arrow Up from a searchable filter starts at the final option');
  await page.keyboard.press('Escape');
  secondProject = false;
  paginationMode = true;
  const pageQueryStart = queries.length;
  await go();
  await page.getByRole('button', { name: 'Next page', exact: true }).waitFor();
  await wait(() => queries.slice(pageQueryStart).some(query => query.page === '2'));
  check(queries.slice(pageQueryStart).every(query => query.grouped === 'true'), 'Prefetch forwards grouped retrieval instead of caching assignments as logical tasks');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor();
  await wait(async () => await page.locator('[data-task-card-id]').count() === 1);
  check(await card.getByText('8 assigned members', { exact: true }).count() === 1, 'Prefetched second page retains one logical card and all member assignments');
  paginationMode = false;
  await go(); await page.locator('[data-task-card-id]').first().waitFor();
  deniedDeletes.add('task-3');
  await card.getByRole('checkbox').check();
  let releaseDeletes;
  deleteBarrier = new Promise(resolve => { releaseDeletes = resolve; });
  const beforeDeletes = deleteCalls.length;
  const deleteButton = page.getByRole('button', { name: 'Delete Selected (8)', exact: true });
  await deleteButton.click();
  await wait(() => deleteCalls.length === beforeDeletes + 4);
  check(await deleteButton.isDisabled() && await deleteButton.getAttribute('aria-busy') === 'true', 'Bulk delete is busy and cannot be submitted twice');
  await deleteButton.evaluate(element => element.click());
  check(deleteCalls.length === beforeDeletes + 4, 'Repeated bulk activation does not duplicate assignment requests');
  check(deleteCalls.length === beforeDeletes + 4, 'Bulk deletion limits in-flight assignment requests to four');
  releaseDeletes(); deleteBarrier = null;
  await page.getByRole('alert').filter({ hasText: 'Synthetic assignment forbidden' }).waitFor();
  await wait(async () => await card.getByText('1 assigned member', { exact: true }).count() === 1);
  check(await page.getByRole('button', { name: 'Delete Selected (1)', exact: true }).count() === 1,
    'Partial deletion removes successful assignments and retains denied assignment selection');
  deniedDeletes.clear();
  await page.getByRole('button', { name: 'Delete Selected (1)', exact: true }).click();
  await page.getByRole('heading', { name: 'No tasks found', exact: true }).waitFor();
  check(await page.locator('[data-task-card-id]').count() === 0, 'Deleting the final assignment cannot resurrect its representative card');
  empty = true; await go();
  await wait(async () => queries.length > 2 && await page.locator('[data-task-card-id]').count() === 0);
  await page.getByRole('heading', { name: 'No tasks found', exact: true }).waitFor();
  check(true, 'Empty grouped result has a visible empty state');
  fail = true; await go();
  await page.getByText(/Synthetic task outage/).first().waitFor();
  check(true, 'Grouped retrieval failure is visible');
  fail = false; empty = false; deleted.clear();
  await page.getByRole('button', { name: 'Retry loading tasks', exact: true }).click();
  await card.first().waitFor();
  check(await card.count() === 1, 'List retrieval errors recover without duplicate quest cards');

  check(errors.length === 0, 'No browser runtime errors');
  return { passed: cases.length, cases, errors };
}
