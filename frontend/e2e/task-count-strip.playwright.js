// Read-only API count/catalog snapshot required at .tmp/task-count-strip/live-counts.json.
// Run with the existing task-groups.mjs runner and the Vite fixture server on port 6337.
async (page) => {
  const fs = await import('node:fs/promises');
  const base = 'http://127.0.0.1:6337';
  const bytes = await fs.readFile('.tmp/task-count-strip/live-counts.json');
  const live = JSON.parse(bytes[0] === 255 ? bytes.toString('utf16le').replace(/^\uFEFF/, '') : bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const manifest = await (await page.request.get(base + '/e2e/navigation-manifest.json')).json();
  const cases = [], errors = [], requests = [];
  const check = (value, name) => { if (!value) throw Error(name); cases.push(name); };
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const active = new Set(); const start = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { const id = start(time => { active.delete(id); callback(time); }); active.add(id); return id; };
    window.cancelAnimationFrame = id => { active.delete(id); cancel(id); };
    window.countFrameProbe = active;
  });
  const order = ['WAITING_FOR_REQUIREMENT','TODO','IN_PROGRESS','BUG_FIXING','BLOCKED','IN_REVIEW','ON_HOLD','DONE','DEPLOYED','FAILED','GRAVEYARD'];
  const data = values => ({ total: values[0], statuses: order.map((id, i) => ({ id, label: live.labels[id] || id.replaceAll('_',' '), count: values[i + 1] ?? 0 })) });
  let apiCounts = data([1000,0,9,10,99,100,1000]);
  let held = false, release;
  await page.routeWebSocket('**/api/ws/**', socket => socket.close({ code: 1000 }));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__count-reels') return route.fulfill({ contentType:'text/html', body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:14px system-ui;background:#070e20}#root{min-width:0}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/e2e/taskCountStripFixture.tsx"></script></body></html>` });
    if (url.pathname === '/__count-integration') {
      const response = await route.fetch({ url:base + '/' });
      return route.fulfill({ response, body:(await response.text()).replace(/src="\/index\.tsx[^\"]*"/, 'src="/e2e/taskNavigationFixture.tsx"') });
    }
    if (url.pathname === '/api/navigation') return route.fulfill({json:{revision:0,actorRole:'owner',canManageGlobal:true,canManagePersonal:true,oauthManagementAccess:'allowed',roles:['owner','admin','manager','user'],apiSections:[],
      pages:manifest.map(p=>({...p,enabled:true,hidden:false,allowedRoles:p.permittedRoles,access:'allowed'}))}});
    if (url.pathname === '/api/kanban-columns') return route.fulfill({json:order.map((id,i)=>({id,title:live.labels[id] || id,order:i,is_active:true}))});
    if (url.pathname === '/api/tasks/page') {
      requests.push(Object.fromEntries(url.searchParams));
      if (held) await new Promise(resolve => { release = resolve; });
      return route.fulfill({json:{items:[],total:apiCounts.total,page:1,page_size:50,total_pages:1,status_counts:Object.fromEntries(apiCounts.statuses.map(s=>[s.id,s.count]))}});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:[]});
    return route.continue();
  });
  const strip = page.getByRole('region',{name:'Task counts',exact:true});
  const set = payload => page.evaluate(data => window.countStripFixture.set(data), payload);
  const settled = async () => { await page.waitForFunction(() => !document.querySelector('[data-rolling="true"]')); };
  await page.setViewportSize({width:1600,height:800});
  await page.goto(base + '/__count-reels'); await strip.waitFor();
  await page.waitForFunction(() => typeof window.countStripFixture?.set === 'function');
  check(await strip.getAttribute('aria-busy') === 'true' && await strip.locator('[data-rolling="true"]').count() === 0, 'Loading waits for valid counts with no reel animation');
  const loadingBox = await strip.boundingBox();
  const initial = data([1000,0,9,10,99,100,1000]);
  initial.statuses[3].label = 'Awaiting client review';
  await set(initial);
  await page.waitForFunction(() => document.querySelectorAll('[data-rolling="true"]').length > 0);
  check(await strip.locator('[data-count-id="WAITING_FOR_REQUIREMENT"] [data-rolling="true"]').count() === 0, 'Initial zero count settles without spinning');
  const sample = strip.locator('[data-count-id="TODO"] .task-count-reel').first();
  const before = await sample.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(110);
  check(await sample.evaluate(el=>getComputedStyle(el).transform) !== before, 'Digits roll vertically using transforms');
  await settled();
  check(await strip.locator('.task-count-label').evaluateAll(nodes=>nodes.every(node=>node.clientHeight===28)), 'Long labels use a consistent two-line header height');
  check((await strip.boundingBox()).height === loadingBox.height, 'Loading and settled card heights remain stable');
  check(await strip.locator('[data-count-id="total"] .task-count-rest').innerText() === '1000', 'Four-digit counts settle to exact sharp static text');
  check(await strip.locator('[data-count-id="TODO"]').getAttribute('aria-label') === initial.statuses[1].label + ': 9', 'Accessible names expose only final status and count');
  check(await strip.locator('.task-count-number[aria-hidden="true"]').count() === 12 && await strip.locator('[aria-live]').count() === 0, 'Decorative reels are hidden and intermediate values are never announced');
  const renders = await page.evaluate(()=>window.countStripFixture.parentRenders);
  await set(data([999,9,1000,99,100,10,0]));
  await page.waitForTimeout(140);
  await set(data([10,1000,99,0,9,100,1000]));
  await page.waitForTimeout(100);
  await set(data([9,0,10,100,1000,99,9]));
  await settled();
  check(await strip.locator('[data-count-id="total"] .task-count-rest').innerText() === '9', 'Rapid increases and decreases retarget to the latest exact count');
  check(await strip.locator('[data-count-id="total"] .task-count-digit').count() === 1, 'Leading reels retire after a decrease without resizing cards');
  check((await page.evaluate(()=>window.countStripFixture.parentRenders)) - renders <= 6, 'Animation never updates the parent on each frame');
  const frameBefore = await page.evaluate(()=>window.countStripFixture.commits);
  await page.evaluate(()=>window.countStripFixture.rerender());
  await set(data([9,0,10,100,1000,99,9]));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(150);
  check(await strip.locator('[data-rolling="true"]').count() === 0 && (await page.evaluate(()=>window.countStripFixture.commits)) - frameBefore < 4, 'Unchanged values, unrelated rerenders and focus never replay settled reels');
  await set(data([1000,0,9,10,99,100,1000]));
  await page.waitForTimeout(100);
  await set(null);
  check(await strip.getAttribute('aria-busy')==='true' && await strip.locator('[data-rolling="true"]').count()===0,
    'Losing valid data during motion cancels reels and restores loading placeholders');
  await page.waitForTimeout(1050);
  await set(data([1000,0,9,10,99,100,1000]));
  await settled();
  check(await strip.locator('[data-count-id="total"] .task-count-rest').innerText()==='1000',
    'The same valid count recovers correctly after interrupted loading');
  await set(data([9,0,10,100,1000,99,9])); await settled();
  for (const width of [1600,1280,768,375,320]) {
    await page.setViewportSize({width,height:800});
    const layout = await strip.evaluate(el=>({viewport:el.clientWidth,scroll:el.scrollWidth,page:document.documentElement.scrollWidth,window:innerWidth,
      cards:[...el.querySelectorAll('.task-count-calendar')].map(c=>({x:c.offsetLeft,y:c.offsetTop,w:c.getBoundingClientRect().width,h:c.getBoundingClientRect().height})),
      panels:[...el.querySelectorAll('.task-count-number')].map(c=>[c.clientWidth,c.scrollWidth])}));
    check(new Set(layout.cards.map(c=>c.y)).size === 1 && new Set(layout.cards.map(c=>c.h)).size === 1 && Math.max(...layout.cards.map(c=>c.w))-Math.min(...layout.cards.map(c=>c.w)) < 1, width + 'px keeps every equal-sized card in one row');
    check(layout.page <= layout.window && layout.panels.every(([w,s])=>s<=w), width + 'px has no page or multi-digit panel overflow');
    if (width===1600) check(layout.scroll<=layout.viewport, 'Desktop fits all readable counters');
    if (width<=768) check(layout.scroll>layout.viewport, width + 'px scrolls within the strip');
    await page.screenshot({path:'.tmp/task-count-strip/calendar-' + width + '.png'});
  }
  await strip.focus(); await page.keyboard.press('End'); await page.waitForFunction(()=>{const el=document.querySelector('.task-count-strip');return el.scrollLeft>=el.scrollWidth-el.clientWidth-1;});
  check(await strip.evaluate(el=>el.scrollLeft>0), 'Keyboard End scrolls to the final card');
  await page.keyboard.press('Home'); await page.waitForFunction(()=>document.querySelector('.task-count-strip').scrollLeft===0);
  check(await strip.evaluate(el=>el.scrollLeft===0), 'Keyboard Home returns to the first card');
  check(await strip.evaluate(el=>getComputedStyle(el).outlineStyle)!=='none', 'Scrollable strip has visible keyboard focus');
  await set(data([1000,9,100,99,10,1000]));
  await page.waitForTimeout(100); await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-rolling="true"]').length===0);
  check(await strip.locator('[data-count-id="total"] .task-count-rest').innerText()==='1000', 'Changing reduced-motion preference cancels in-flight reels immediately');
  await set(data([99,1000,10])); await page.waitForTimeout(30);
  check(await strip.locator('[data-rolling="true"]').count()===0 && await strip.locator('[data-count-id="total"] .task-count-rest').innerText()==='99', 'Reduced-motion updates show final counts without animation');
  await page.evaluate(()=>window.countStripFixture.unmount()); await page.waitForTimeout(100);
  check(await strip.count()===0 && await page.evaluate(()=>window.countFrameProbe.size)===0, 'Unmount cleans animation frames and removes the strip');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.reload(); await strip.waitFor(); await set(initial); await page.waitForFunction(()=>document.querySelector('[data-rolling="true"]'));
  check(await strip.locator('[data-rolling="true"]').count()>0, 'Fresh reload animates again after its first valid snapshot');
  await page.evaluate(()=>window.countStripFixture.unmount()); await page.waitForTimeout(150);
  check(await page.evaluate(()=>window.countFrameProbe.size)===0, 'Unmount during motion cancels active animation frames');

  // Integration exercises the existing Tasks page, HTTP mapper, status catalog and filters.
  held = true; apiCounts = data([live.total,...order.map(id=>live.status_counts[id] ?? 0)]);
  await page.setViewportSize({width:1600,height:1000});
  const go = extra => page.goto(base + '/__count-integration?networkTaskPage=1&rows=0' + (extra||'') + '#/tasks');
  await go(); await strip.waitFor();
  check(await strip.getAttribute('aria-busy')==='true', 'All Tasks preserves the strip layout while waiting for its API response');
  await page.waitForFunction(()=>window.taskNavigationAudit.calls.some(c=>c.method==='getTasksPage'));
  await page.waitForTimeout(100); held=false; release();
  await page.waitForFunction(()=>document.querySelector('.task-count-strip')?.getAttribute('aria-busy')==='false'); await settled();
  check(await strip.locator('[data-count-id="total"]').getAttribute('data-count-value')===String(live.total), 'All Tasks total matches the real read-only backend count snapshot');
  for (const id of order) check(await strip.locator(`[data-count-id="${id}"]`).getAttribute('aria-label')===(live.labels[id]||id) + ': ' + (live.status_counts[id]??0), 'Live API count and configured label match for ' + id);
  check(JSON.stringify(await strip.locator('[data-count-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.countId)))===JSON.stringify(['total',...order]), 'Existing status order is unchanged');
  check(await strip.locator('button,a').count()===0, 'Read-only summary cards retain their existing non-filtering behavior');
  await strip.screenshot({path:'.tmp/task-count-strip/live-calendar-strip.png'});
  await page.getByRole('button',{name:'All Statuses',exact:true}).click();
  await Promise.all([
    page.waitForResponse(response=>response.url().includes('/api/tasks/page') && new URL(response.url()).searchParams.get('status')==='IN_PROGRESS'),
    page.getByRole('listbox',{name:'All Statuses',exact:true}).getByRole('option',{name:live.labels.IN_PROGRESS,exact:true}).click(),
  ]);
  await page.waitForFunction(()=>document.querySelector('.task-count-strip')?.getAttribute('aria-busy')==='false');
  check(requests.some(q=>q.status==='IN_PROGRESS'), 'Existing status filter still reaches the original API unchanged');
  check(await strip.locator('[data-rolling="true"]').count()===0, 'Unchanged count responses from filtering do not replay the reels');
  for (const theme of ['light', 'colorful', 'dark']) {
    await page.evaluate(theme=>localStorage.setItem('zenith-task-theme',theme), theme);
    await go(); await page.reload(); await strip.waitFor(); await settled();
    check(await strip.locator('.task-count-number').first().evaluate(el=>getComputedStyle(el).color)==='rgb(241, 249, 255)', theme + ' theme retains bright readable digits on navy panels');
    for (const width of [1600,768,375]) {
      await page.setViewportSize({width,height:1000});
      const layout = await strip.evaluate(el=>{
        const page=document.documentElement.scrollWidth; el.style.display='none';
        const withoutStrip=document.documentElement.scrollWidth; el.style.display='';
        return {page,withoutStrip,viewport:innerWidth,right:el.getBoundingClientRect().right,
          theme:document.documentElement.className,
          rows:new Set([...el.querySelectorAll('.task-count-calendar')].map(card=>card.offsetTop)).size};
      });
      check(layout.rows===1 && layout.right<=layout.viewport && layout.page<=Math.max(layout.viewport,layout.withoutStrip), theme + ' All Tasks at ' + width + 'px keeps one row and adds no page overflow');
    }
    await strip.screenshot({path:'.tmp/task-count-strip/live-' + theme + '-mobile.png'});
  }
  await go('&role=user&account=counter-restricted');
  await page.getByPlaceholder('Search Tasks').waitFor();
  check(await strip.count()===0, 'Ordinary users retain the existing count-strip visibility restriction');
  check(errors.length===0, 'No browser exceptions');
  return {cases,errors,live:{total:live.total,status_counts:live.status_counts}};
}
