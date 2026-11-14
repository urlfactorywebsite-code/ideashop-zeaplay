// Actual Tasks page, API mapper, caches, modal and Kanban with synthetic loopback-only data.
async (page) => {
  await page.goto('about:blank');
  await page.unrouteAll({behavior:'wait'});
  const base = 'http://127.0.0.1:6337';
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const cases = [], errors = [], queries = [], partyQueries = [];
  const check = (condition, name) => { if (!condition) throw Error(name); cases.push(name); };
  const wait = async predicate => { const end = Date.now() + 15000; while (!await predicate()) {
    if (Date.now() > end) throw Error('Timed out waiting for task UI'); await new Promise(resolve => setTimeout(resolve, 50));
  } };
  let empty = false, fail = false, paginationMode = false, deferParty = false, releaseParty = null, secondProject = false, deleteBarrier = null;
  const deleted = new Set(), deniedDeletes = new Set(), deleteCalls = [];
  let personalAssignment = false;
  let restrictedParty = false;
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
    if (url.pathname === '/__task-groups' || url.pathname === '/__group-preview-review') {
      const response = await route.fetch({ url: base + '/' });
      const fixture = url.pathname === '/__group-preview-review' ? 'groupQuestPreviewFixture' : 'taskNavigationFixture';
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, `src="/e2e/${fixture}.tsx"`) });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({ json: { revision: 0, actorRole: 'owner', canManageGlobal: true,
      canManagePersonal: true, oauthManagementAccess: 'allowed', roles: ['owner','admin','manager','user'], apiSections: [],
      pages: manifest.map(item => ({ ...item, enabled: true, hidden: false, allowedRoles: item.permittedRoles,
        access: item.permittedRoles.includes('owner') ? 'allowed' : 'forbidden' })) } });
    if (url.pathname === '/api/tasks/page') {
      queries.push(Object.fromEntries(url.searchParams));
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Synthetic task outage' } });
      const available = assignments.filter(item => !deleted.has(item.id) && (!personalAssignment || item.assigned_to_id === 'member-2'));
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
      const json = assignments.filter(item => (!personalAssignment || item.assigned_to_id === 'member-2') &&
        (!restrictedParty || item.id === 'task-7')).map(item => ({ ...item, can_edit: true }));
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
  await page.getByRole('button', { name: /List/i, exact: true }).click();
  check(await page.locator('[data-task-card-id]').count() === 1, 'List renders one logical task for eight members');
  check(queries.every(query => query.grouped === 'true'), 'List API opts in to server grouping');
  const card = page.locator('[data-task-card-id]');
  check(await card.getByText('8 assignments', { exact: true }).count() === 1, 'List shows assignment count');
  check((await card.boundingBox()).height <= 260, 'Desktop grouped list stays compact');
  check(await card.getByText('25% complete', { exact: true }).count() === 1, 'Progress reflects independent assignments');
  await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
  const assignmentList = page.getByRole('list', { name: 'Task assignments' });
  await assignmentList.waitFor();
  check(await assignmentList.getByRole('button').count() === 8, 'Card opens all authorized assignment rows');
  await assignmentList.locator('[data-assignment-id="task-3"] button').press('Enter');
  const detail = page.getByRole('dialog', { name: 'Quest details' });
  await detail.waitFor();
  check(await detail.locator('[data-assignment-task-id="task-3"]').count() === 1, 'Keyboard activation opens its original assignment ID');
  check(await detail.locator('.quest-party-panel').count() === 0, 'List and Grid details omit the assigned-members sidebar');
  await detail.getByRole('button', { name: 'Back to assignments', exact: true }).click();
  await assignmentList.waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await go(); await page.locator('[data-task-card-id]').first().waitFor();

  await page.evaluate(() => { window.questPointsReads = 0; const original = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (key === 'task-points-config') window.questPointsReads++; return original.call(this, key); }; });
  await card.getByRole('checkbox').focus();
  await card.getByRole('checkbox').press('Space');
  check(await card.getByRole('checkbox').isChecked() && await page.getByRole('dialog').count() === 0, 'Space selects the task without opening its details');
  check(await card.locator('.task-selection-check').evaluate(element => getComputedStyle(element).opacity === '1'), 'Checked task shows its styled checkmark');
  check(await page.evaluate(() => window.questPointsReads) === 0, 'Selection does not recompute unchanged Group Quest rewards');
  check(await page.getByRole('button', { name: 'Delete Selected (8)', exact: true }).count() === 1, 'Group selection retains all eight assignment IDs');
  assignments.push({ ...assignments[7], id: 'extra-task', assigned_to_id: 'extra-member', assigned_member: { id: 'extra-member', name: 'Extra member', avatar_url: null } });
  await page.evaluate(() => window.taskNavigationAudit.changed());
  await card.getByText('9 assignments', { exact: true }).waitFor();
  check(await card.getByRole('checkbox').evaluate(element => element.indeterminate), 'New party membership exposes a mixed selection to assistive technology');
  check(await card.getByRole('checkbox').getAttribute('aria-checked') === 'mixed' && await card.locator('.task-selection-mixed').evaluate(element => getComputedStyle(element).opacity === '1'), 'Partial selection displays the styled minus indicator');
  await card.getByRole('checkbox').click();
  check(await page.getByRole('button', { name: 'Delete Selected (9)', exact: true }).count() === 1, 'Selecting a mixed group adds only its newly visible assignment');
  assignments.pop();
  await go(); await card.first().waitFor();
  await card.getByRole('checkbox').check();

  await page.getByRole('button', { name: /Grid/i, exact: true }).click();
  await wait(async () => await page.locator('[data-task-card-id]').count() === 1);
  check(await card.getByText('8 assignments', { exact: true }).count() === 1, 'Grid renders one card with all members');
  check(await card.getByText('Group Quest', { exact: true }).count() === 1 && await card.getByLabel('Overall status: Mixed statuses').count() === 1, 'Group card shows party identity and an honest aggregate status');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await card.evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(value => Number.parseFloat(value) === 0)), 'Group cards respect reduced motion');
  for (const theme of ['light', 'colorful']) {
    await page.evaluate(theme => localStorage.setItem('zenith-task-theme', theme), theme);
    await go(); await card.first().waitFor();
    await page.getByRole('button', { name: /Grid/i, exact: true }).click();
    check(await card.evaluate(el => el.scrollWidth <= el.clientWidth), theme + ' grouped cards have no horizontal overflow');
    await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
    await assignmentList.waitFor();
    const avatar = assignmentList.locator('[role="img"]').first();
    const contrast = await avatar.evaluate(el => {
      const style = getComputedStyle(el);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const text = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    check(contrast >= 4.5, 'Assignment avatar initials meet normal-text contrast in ' + theme);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.evaluate(() => localStorage.setItem('zenith-task-theme', 'dark'));
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
  check(await card.first().getByText('8 assignments', { exact: true }).count() === 1, 'Status filtering retains all visible members of each matching logical quest');
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
  check(await card.getByText('8 assignments', { exact: true }).count() === 1, 'Prefetched second page retains one logical card and all member assignments');
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
  await wait(async () => await card.getByText('1 task', { exact: true }).count() === 1);
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

  personalAssignment = true;
  await go('&personalAssignment=1&networkParty=1&account=member-2&role=user');
  await card.first().waitFor();
  for (const view of ['List', 'Grid']) {
    await page.getByRole('button', { name: new RegExp(view, 'i'), exact: true }).click();
    await card.getByText('1 task', { exact: true }).waitFor();
    check(await card.count() === 1, view + ' keeps one authorized personal card');
    await card.getByRole('button', { name: 'Shared mission', exact: true }).click();
    await detail.waitFor();
    check(await page.getByRole('list', { name: 'Task assignments' }).count() === 0 && await detail.getByRole('button', { name: 'Back to assignments', exact: true }).count() === 0, view + ' opens the authorized solo assignment directly');
    check(!(await detail.innerText()).match(/Member [0134567]/), view + ' contains no restricted sibling identities');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.goto(base + '/__group-preview-review');
  await page.getByRole('heading', { name: 'Private cached assignment', exact: true }).waitFor();
  check(true, 'Authorized creator preview still opens normally');
  await page.evaluate(() => window.groupPreviewReview.switchRole('user'));
  await page.getByText('Loading zea.play quest intel...', { exact: true }).waitFor();
  check(!(await page.locator('body').innerText()).includes('Private cached assignment'), 'Permission downgrade clears the cached preview before a fresh response');
  await page.evaluate(() => window.groupPreviewReview.switchRole('owner'));
  await page.getByText('Loading zea.play quest intel...', { exact: true }).waitFor();
  check(!(await page.locator('body').innerText()).includes('Private cached assignment'), 'Returning to an earlier role cannot restore an unverified preview');
  await page.evaluate(() => window.groupPreviewReview.release());
  await page.getByRole('heading', { name: 'Private cached assignment', exact: true }).waitFor();
  check(true, 'Fresh authorized response restores task details after a permission change');
  check(errors.length === 0, 'No browser runtime errors');
  return { passed: cases.length, cases, errors };
}
