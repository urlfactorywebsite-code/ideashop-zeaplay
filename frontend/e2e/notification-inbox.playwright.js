// Run against loopback Vite :6337. Real Header/auth/hook with synthetic APIs/SSE.
async (page) => {
  const base = 'http://127.0.0.1:6337';
  const cases = [], errors = [], writes = [];
  const check = (value, name) => { if (!value) throw new Error(name); cases.push(name); };
  const stamp = '2026-11-06T06:00:00Z';
  const make = (id, message, type = 'TASK_UPDATED', is_read = false) => ({ id, message, type, is_read,
    user_id: 'inbox-owner', tenant_id: 'inbox-guild', created_at: stamp, related_task_id: null, related_reward_id: null });
  let account = 'owner', failDelete = false, holdDelete = false, releaseDelete = null;
  let holdList = false, releaseList = null, readArrival = false;
  let data = { owner: [make('n1', 'Guild résumé task updated'), make('n2', 'Guild project update', 'PROJECT_UPDATED', true),
    make('n3', 'Long task ' + 'x'.repeat(180)), make('n4', 'Guild chat message', 'CHAT_MESSAGE')], other: [] };
  const emit = () => page.evaluate(() => window.__emitInboxNotifications());
  const panel = page.locator('#notification-inbox');
  const row = id => panel.locator(`[data-notification-id="${id}"]`);
  const wait = async predicate => {
    const end = Date.now() + 8000;
    while (!await predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for scenario'); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  page.on('pageerror', error => { errors.push(error.message); console.log('Notification browser error:', error.message); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const streams = [];
    window.fetch = (input, options) => {
      if (!String(input).endsWith('/notifications/stream')) return nativeFetch(input, options);
      const state = { controller: null, closed: false };
      const body = new ReadableStream({ start(controller) {
        state.controller = controller;
        options.signal.addEventListener('abort', () => { state.closed = true; try { controller.close(); } catch {} });
      } });
      streams.push(state);
      return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
    window.__emitInboxNotifications = () => {
      const state = streams.filter(item => !item.closed).at(-1);
      state?.controller.enqueue(new TextEncoder().encode('event: notifications.changed\ndata: {}\n\n'));
    };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__notification-inbox') {
      const response = await route.fetch({ url: base + '/' });
      return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/notificationInboxFixture.tsx"') });
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.__RUNTIME_CONFIG__={API_URL:'${base}/api'};` });
    if (url.pathname === '/api/auth/websocket-ticket') return route.fulfill({ status: 503, json: { detail: 'Synthetic offline task socket' } });
    if (url.pathname === '/api/notifications' && route.request().method() === 'GET') {
      const snapshot = structuredClone(data[account]);
      if (holdList) {
        holdList = false;
        return new Promise(resolve => { releaseList = async () => { await route.fulfill({ json: snapshot }); resolve(); releaseList = null; }; });
      }
      return route.fulfill({ json: snapshot });
    }
    if (url.pathname === '/api/notifications/read-all') {
      writes.push({ action: 'read-all', account });
      data[account] = data[account].map(item => ({ ...item, is_read: true }));
      if (readArrival) { readArrival = false; data[account].push(make('arrived', 'Arrived after read transaction')); await emit(); }
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/api/notifications/bulk-delete') {
      const owner = account, ids = route.request().postDataJSON().notification_ids;
      writes.push({ action: 'delete', ids, account: owner });
      if (failDelete) { failDelete = false; return route.fulfill({ status: 503, json: { detail: 'Deletion temporarily unavailable' } }); }
      const complete = async () => {
        data[owner] = data[owner].filter(item => !ids.includes(item.id));
        await route.fulfill({ json: { deleted_ids: ids } });
      };
      if (holdDelete) {
        holdDelete = false;
        return new Promise(resolve => { releaseDelete = async () => { await complete(); resolve(); releaseDelete = null; }; });
      }
      return complete();
    }
    if (/^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
      const id = url.pathname.split('/')[3]; writes.push({ action: 'read', id });
      data[account] = data[account].map(item => item.id === id ? { ...item, is_read: true } : item);
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    return route.continue();
  });
  await page.goto(base + '/__notification-inbox#/tasks');
  const bell = () => page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await bell().waitFor();
  await bell().click();
  await row('n4').waitFor();
  check(await panel.locator('button button').count() === 0 && await panel.getByRole('list', { name: 'Notification list' }).count() === 1,
    'notification actions are separate buttons within a named semantic list');
  check(await panel.getByRole('textbox', { name: 'Search notifications' }).count() === 0, 'filters stay inside the filter icon');
  await panel.getByRole('button', { name: /^Filter notifications/ }).click();
  await panel.getByRole('searchbox', { name: 'Search notifications' }).waitFor();
  check(await panel.getByRole('searchbox').evaluate(element => element === document.activeElement), 'filter search receives keyboard focus');
  await panel.getByRole('combobox', { name: 'Category' }).selectOption('tasks');
  await wait(async () => await panel.locator('li').count() === 2);
  check(await row('n2').count() === 0, 'category filter shows only matching notifications');
  await panel.getByRole('combobox', { name: 'Read status' }).selectOption('read');
  await panel.getByText('No notifications match your filters.').waitFor(); cases.push('filtered empty state');
  await panel.getByRole('combobox', { name: 'Read status' }).selectOption('unread');
  await panel.getByRole('searchbox').fill('RÉSUMÉ');
  await wait(async () => await panel.locator('li').count() === 1);
  check(await row('n1').count() === 1, 'search and read/category filters combine');
  await panel.getByRole('button', { name: 'Reset filters' }).click();
  await row('n4').waitFor();
  await page.keyboard.press('Escape');
  check(await panel.getByRole('button', { name: /^Filter notifications/ }).getAttribute('aria-expanded') === 'false', 'Escape closes the filter panel');
  const original = page.url();
  await row('n1').getByRole('button').first().click({ modifiers: ['Control'] });
  await panel.getByText('1 selected', { exact: true }).waitFor();
  check(page.url() === original && writes.length === 0, 'Ctrl+click selects without navigation or marking read');
  await row('n3').getByRole('button').first().click({ modifiers: ['Meta'] });
  await panel.getByText('2 selected', { exact: true }).waitFor(); cases.push('Cmd+click adds to selection');
  await row('n1').getByRole('checkbox').click();
  await panel.getByText('1 selected', { exact: true }).waitFor();
  await row('n1').getByRole('checkbox').focus(); await page.keyboard.press('Space');
  await panel.getByText('2 selected', { exact: true }).waitFor(); cases.push('checkbox selection works with pointer and keyboard');
  await panel.getByRole('button', { name: 'Select all shown' }).click();
  await panel.getByText('4 selected', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Delete selected', exact: true }).click();
  check(await panel.getByRole('button', { name: 'Cancel deletion' }).evaluate(element => element === document.activeElement), 'bulk confirmation focuses Cancel');
  await panel.getByRole('button', { name: 'Cancel deletion' }).click();
  check(writes.length === 0, 'cancel deletion preserves history');
  await panel.getByRole('button', { name: /^Filter notifications/ }).click();
  await panel.getByRole('combobox', { name: 'Read status' }).selectOption('read');
  await panel.getByText('0 selected', { exact: true }).waitFor(); cases.push('filter change clears hidden selection');
  await panel.getByRole('button', { name: 'Select all shown' }).click();
  await panel.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await wait(async () => !data.owner.some(item => item.id === 'n2'));
  check(writes.at(-1).ids.length === 1 && writes.at(-1).ids[0] === 'n2', 'bulk delete only sends explicitly selected filtered IDs');
  await panel.getByRole('button', { name: 'Reset filters' }).click();
  await panel.getByRole('combobox', { name: 'Read status' }).selectOption('unread');
  await panel.getByRole('button', { name: 'Select all shown' }).click();
  await panel.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await panel.getByText('No notifications match your filters.').waitFor();
  await panel.getByText('0 selected', { exact: true }).waitFor();
  check(data.owner.every(item => item.is_read), 'mark all as read includes the full inbox and clears no-longer-visible selection');
  await panel.getByRole('button', { name: 'Reset filters' }).click();
  await panel.getByRole('button', { name: 'Done selecting' }).click();
  failDelete = true;
  await row('n1').getByRole('button', { name: 'Delete notification', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  check(data.owner.some(item => item.id === 'n1') && await row('n1').count() === 1, 'delete failure preserves notification and shows an error');
  await row('n1').getByRole('button', { name: 'Delete notification', exact: true }).click();
  await row('n1').waitFor({ state: 'detached' }); cases.push('delete retry succeeds');

  // A stale GET that started before deletion cannot resurrect deleted history.
  holdList = true; await emit(); await wait(async () => !!releaseList);
  await row('n3').getByRole('button', { name: 'Delete notification', exact: true }).click();
  await row('n3').waitFor({ state: 'detached' });
  const old = releaseList; holdList = true; await old(); await wait(async () => !!releaseList);
  check(await row('n3').count() === 0, 'in-flight stale GET cannot resurrect a deleted notification');
  await releaseList();
  await panel.getByRole('button', { name: 'Close notifications', exact: true }).click();
  data.owner.push({ ...make('normal', 'Open task notification'), related_task_id: 'parent-task' });
  await emit();
  await bell().click(); await row('normal').waitFor();
  await row('normal').getByRole('button').first().click();
  await wait(async () => page.url().includes('taskId=parent-task'));
  await wait(async () => writes.some(item => item.action === 'read' && item.id === 'normal'));
  cases.push('ordinary click still navigates and marks the single item read');

  // Notifications arriving after read-all commits must remain unread.
  data.owner.push(make('before-read', 'Before read')); await emit();
  await bell().click(); await row('before-read').waitFor(); readArrival = true;
  await panel.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await row('arrived').waitFor();
  await wait(async () => await bell().getAttribute('aria-label') === 'Notifications, 1 unread');
  check(data.owner.find(item => item.id === 'arrived').is_read === false, 'post-commit arrival remains unread');
  await page.screenshot({ path: '.tmp/notification-inbox-desktop.png', fullPage: true });

  // A delayed mutation response cannot remove another account's same synthetic ID.
  holdDelete = true;
  await row('arrived').getByRole('button', { name: 'Delete notification', exact: true }).click();
  await wait(async () => !!releaseDelete);
  account = 'other';
  data.other = [{ ...make('arrived', 'Other workspace notification'), user_id: 'inbox-other', tenant_id: 'other-guild' }];
  await page.evaluate(() => window.notificationInboxFixture.switchAccount());
  await wait(async () => await panel.count() === 0);
  await bell().click(); await panel.getByText('Other workspace notification', { exact: true }).waitFor();
  await releaseDelete();
  check(await panel.getByText('Other workspace notification', { exact: true }).count() === 1, 'account switch isolates late deletion response');
  check(await panel.getByRole('checkbox').count() === 0, 'account switch clears selection');

  account = 'owner'; data.owner = [make('mobile', 'Mobile task ' + 'W'.repeat(200))];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/__notification-inbox#/tasks');
  await page.reload();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await bell().click(); await row('mobile').waitFor();
  await panel.getByRole('button', { name: /^Filter notifications/ }).click();
  const box = await panel.boundingBox();
  check(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, 'mobile inbox stays within the viewport');
  check(await row('mobile').evaluate(element => element.scrollWidth <= element.clientWidth), 'long notification messages do not overflow');
  await page.screenshot({ path: '.tmp/notification-inbox-mobile.png', fullPage: true });
  await panel.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await wait(async () => await bell().getAttribute('aria-label') === 'Notifications, 0 unread');
  cases.push('mobile mark-all-read succeeds inside the portal');
  await panel.getByRole('button', { name: 'Select', exact: true }).click();
  await row('mobile').getByRole('checkbox').click();
  await panel.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 420 });
  const shortBox = await panel.boundingBox();
  check(shortBox.y >= 0 && shortBox.y + shortBox.height <= 420, 'short viewport keeps confirmation inside the screen');
  await panel.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await panel.getByText('No notifications yet.').waitFor();
  cases.push('mobile checkbox selection and confirmed bulk deletion succeed');
  await panel.getByRole('button', { name: 'Done selecting', exact: true }).click();
  check(await panel.getByRole('checkbox').count() === 0, 'selection mode can end after deleting the last notification');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  check(await panel.count() === 0 && await bell().evaluate(element => element === document.activeElement), 'Escape closes inbox and restores bell focus');
  check(errors.length === 0, 'no browser runtime errors: ' + errors.join('; '));
  return { passed: cases.length, cases };
}
