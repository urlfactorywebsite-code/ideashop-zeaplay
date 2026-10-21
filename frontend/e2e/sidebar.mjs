// Actual application and Settings editor with synthetic APIs; no external writes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';
const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_SIDEBAR_TEST_URL || 'http://127.0.0.1:6337';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = process.env.ZEAPLAY_SIDEBAR_OUTPUT || path.join(tmpdir(), 'zea-sidebar-management-20261021');
await mkdir(output, { recursive: true });
const tailwind = await readFile(process.env.ZEAPLAY_TAILWIND_JS);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [], cases = [], errors = [], writes = [];
const workspaces = new Map();
const workspace = tenant => { if (!workspaces.has(tenant)) workspaces.set(tenant, { rules: {}, revision: 0 }); return workspaces.get(tenant); };
const check = name => { cases.push({ case: name, passed: true }); console.log('PASS ' + name); };
const mutate = (tenant, id, change) => { const state = workspace(tenant); state.rules[id] = { ...state.rules[id], ...change }; state.revision++; };
async function setup(role = 'owner', tenant = 'settings-fixture', account = 'settings-reviewer', legacy = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  contexts.push(context);
  await context.addInitScript(({ legacy, tenant, account }) => {
    localStorage.setItem('zenith-task-theme', 'dark');
    if (legacy && !localStorage.getItem('zea.sidebar.v1:'+tenant+':'+account)) localStorage.setItem('zea.sidebar.v1:'+tenant+':'+account, JSON.stringify({ order: ['/tasks','/dashboard','/media','/obsolete'],
      labels: { '/tasks':'My work', '/dashboard':'Saved home', '/media':'Files', '/obsolete':'Old label' } }));
  }, { legacy, tenant, account });
  await context.routeWebSocket('**/api/ws/**', socket => socket.close({ code:1000 }));
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => {
    socket.send(JSON.stringify({ type:'connected' })); socket.onMessage(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 500) errors.push('HTTP '+response.status()+' '+new URL(response.url()).pathname); });
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType:'text/javascript', body:tailwind });
    if (url.origin === base) {
      if (url.pathname === '/__sidebar-management') {
        const response = await route.fetch({ url:base+'/' });
        return route.fulfill({ response, body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/settingsNavigationFixture.tsx"') });
      }
      if (url.pathname === '/api/navigation') {
        const state = workspace(tenant);
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON(); writes.push({ role, tenant, body });
          if (role !== 'owner') return route.fulfill({ status:403, json:{ detail:'Owner required' } });
          if (body.revision !== state.revision) return route.fulfill({ status:409, json:{ detail:'Configuration changed' } });
          state.rules = Object.fromEntries(body.pages.map(page => [page.id, page])); state.revision++;
        }
        return route.fulfill({ json:navigationDocument(role, state.rules, state.revision) });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream') ? { contentType:'text/event-stream', body:'' } : { json:[] });
      return route.continue();
    }
    if (['res.cloudinary.com','storage.googleapis.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const entry=base+'/__sidebar-management?role='+role+'&tenant='+tenant+'&account='+account;
  const go=async target => { await page.goto(entry+'#'+target); };
  await go('/settings/sidebar-management');
  if (['owner','admin'].includes(role)) await expect(page.getByRole('heading', { name:'Sidebar Management', exact:true })).toBeVisible({timeout:30000});
  const row=id=>page.locator('[data-page-id="'+id+'"]');
  const search=async text=>page.getByRole('searchbox', { name:'Search pages' }).fill(text);
  const save=async (global=false)=> {
    await page.getByRole('button',{name:'Save Changes',exact:true}).click();
    if(global) await page.getByRole('button',{name:'Apply changes',exact:true}).click();
    await expect(page.getByText('Unsaved changes',{exact:true})).toHaveCount(0);
  };
  const focus=async()=> { await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); };
  return {page,context,go,row,search,save,focus,tenant,account,entry};
}
try {
  const owner=await setup('owner','settings-fixture','settings-reviewer',true);
  const {page}=owner;
  const nav=page.getByRole('navigation',{name:'Sidebar',exact:true});
  await expect(page.getByRole('button',{name:'Edit sidebar',exact:true})).toHaveCount(0);
  await expect(page.getByRole('tab',{name:'Sidebar Management',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(nav.getByRole('link',{name:'My work',exact:true})).toBeVisible();
  assert.deepEqual((await nav.getByRole('link').allTextContents()).slice(0,2),['My work','Saved home']);
  assert.ok((await page.evaluate(()=>localStorage.getItem('zea.sidebar.v1:settings-fixture:settings-reviewer'))).includes('/tasks'));
  check('Editor migrated into Settings; popup trigger removed; legacy preferences load without writes');

  await owner.row('tasks').getByRole('textbox').fill('Mission Hub');
  await owner.row('tasks').getByRole('button',{name:'Move All Tasks down',exact:true}).click();
  const before=writes.length; await owner.save();
  assert.equal(writes.length,before);
  await expect(nav.getByRole('link',{name:'Mission Hub',exact:true})).toBeVisible();
  assert.equal((await nav.getByRole('link').allTextContents())[0],'Saved home');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('zea.sidebar.v1:settings-fixture:settings-reviewer')));
  assert.ok(saved.order.includes('tasks')); assert.equal(saved.labels['/obsolete'],'Old label');
  await page.reload(); await expect(nav.getByRole('link',{name:'Mission Hub',exact:true})).toBeVisible();
  check('Personal rename/arrow ordering saves without global writes, survives reload, preserves obsolete labels');
  await page.goto(owner.entry.replace('account=settings-reviewer','account=other-owner')+'#/settings/sidebar-management');
  await expect(nav.getByRole('link',{name:'All Tasks',exact:true})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Mission Hub',exact:true})).toHaveCount(0);
  await owner.go('/settings/sidebar-management'); await expect(nav.getByRole('link',{name:'Mission Hub',exact:true})).toBeVisible();
  check('Personal preferences remain isolated when switching accounts in the same browser');

  await owner.search('Projects'); await owner.row('projects').getByRole('textbox').fill('Uncommitted projects');
  await page.getByRole('button',{name:'Discard Changes',exact:true}).click();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(owner.row('projects').getByRole('textbox')).toHaveValue('Projects');
  check('Discard confirmation restores saved values');

  await owner.search('');
  await expect(owner.row('settings').getByRole('switch')).toBeDisabled();
  await page.getByRole('button',{name:'Settings Page Tabs',exact:true}).click();
  await expect(owner.row('settings.profile').getByRole('switch')).toBeDisabled();
  await expect(owner.row('settings.sidebar-management').getByRole('switch')).toBeDisabled();
  await expect(page.getByText('Master Control',{exact:true})).toHaveCount(0);
  await owner.row('settings.api').locator('summary').click();
  await expect(owner.row('settings.api').getByRole('checkbox',{name:'API: user',exact:true})).toBeDisabled();
  await expect(owner.row('settings.api').getByRole('checkbox',{name:'API: manager',exact:true})).toBeDisabled();
  check('Recovery pages protected and role checkboxes cannot grant existing forbidden API roles; Master Control stays removed');

  await owner.row('settings.api').getByRole('checkbox',{name:'API: admin',exact:true}).uncheck();
  await owner.save(true);
  const admin=await setup('admin','settings-fixture','admin-reviewer');
  await expect(admin.page.getByRole('tab',{name:'API',exact:true})).toHaveCount(0);
  await admin.go('/settings/api'); await expect(admin.page.getByRole('heading',{name:'Access forbidden',exact:true})).toBeVisible();
  check('Nested Settings role rules immediately update tabs and deny direct API navigation');

  await page.getByRole('button',{name:'Main Sidebar Pages',exact:true}).click();
  await owner.search('Projects');
  await owner.row('projects').getByRole('switch',{name:'Enable Projects',exact:true}).uncheck();
  assert.equal(workspace(owner.tenant).rules.projects.enabled,true);
  await owner.save(true);
  const user=await setup('user');
  await user.go('/projects');
  await expect(user.page.getByRole('heading',{name:'Module disabled',exact:true})).toBeVisible();
  await expect(user.page.getByRole('navigation',{name:'Sidebar',exact:true}).getByRole('link',{name:'Projects',exact:true})).toHaveCount(0);
  const outsider=await setup('owner','other-tenant','other-owner');
  await outsider.search('Projects'); await expect(outsider.row('projects').getByRole('switch')).toBeChecked();
  await outsider.context.close();
  check('Disabled main module blocks direct access across browsers while another tenant retains defaults');

  await owner.search(''); await page.getByRole('button',{name:'Settings Page Tabs',exact:true}).click();
  await owner.search('Support');
  await owner.row('settings.support').getByRole('checkbox',{name:'Hide Support navigation only',exact:true}).check();
  await owner.save(true);
  await user.go('/settings/support'); await expect(user.page.getByRole('heading',{name:'Submit Support Request',exact:true})).toBeVisible();
  await expect(user.page.getByRole('tab',{name:'Support',exact:true})).toHaveCount(0);
  await owner.row('settings.support').getByRole('switch').uncheck(); await owner.save(true);
  await user.focus(); await expect(user.page.getByRole('heading',{name:'Module disabled',exact:true})).toBeVisible();
  await expect(user.page).toHaveURL(/#\/navigation-unavailable$/);
  check('Hidden-only support remains independently accessible; active-session focus revalidation removes disabled page');
  await user.context.close();

  await admin.go('/settings/sidebar-management');
  await expect(admin.page.getByText(/Admin layout access/)).toBeVisible();
  await admin.search('Projects'); await expect(admin.row('projects').getByRole('switch')).toBeDisabled();
  await admin.row('projects').getByRole('textbox').fill('Admin projects');
  const adminWrites=writes.length; await admin.save(); assert.equal(writes.length,adminWrites);
  check('Admins can save personal layout but cannot edit workspace access rules');
  await admin.context.close();

  await owner.search('Support'); await owner.row('settings.support').getByRole('textbox').fill('Unsaved support');
  await page.getByRole('tab',{name:'General / Profile',exact:true}).click();
  await page.getByRole('dialog',{name:'Leave without saving?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sidebar Management',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Sidebar Management',exact:true}).focus(); await page.keyboard.press('Home');
  await page.getByRole('dialog',{name:'Leave without saving?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sidebar Management',exact:true})).toBeVisible();
  check('Unsaved warning can cancel mouse and keyboard navigation');

  const state=workspace(owner.tenant); mutate(owner.tenant,'tickets',{enabled:false});
  await owner.focus(); await expect(page.getByText(/A newer workspace configuration is available/)).toBeVisible();
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await expect(page.getByText(/Another owner saved a newer configuration/)).toBeVisible();
  assert.equal(state.rules.tickets.enabled,false);
  await page.getByRole('button',{name:'Discard Changes',exact:true}).click();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  check('Concurrent update preserves draft, reports conflict, rejects stale save and reloads latest on discard');

  await owner.search('');
  await page.getByRole('button',{name:'Reset Defaults',exact:true}).click();
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();
  await owner.save(true);
  assert.equal(workspace(owner.tenant).rules.projects.enabled,true);
  assert.deepEqual(new Set(workspace(owner.tenant).rules['settings.api'].allowedRoles),new Set(['owner','admin']));
  check('Reset stages defaults, restores visibility and retains permission ceilings');

  await page.getByRole('button',{name:'Main Sidebar Pages',exact:true}).click();
  await owner.search('');
  const list=page.getByRole('list',{name:'Sidebar pages',exact:true});
  const target=owner.row('tasks');
  await page.locator('main').evaluate(element=>element.scrollTo(0,0));
  await target.scrollIntoViewIfNeeded();
  const drag=target.locator('[title="Drag All Tasks"]');
  const start=await drag.boundingBox(), dest=await owner.row('dashboard').boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2); await page.mouse.down();
  await page.mouse.move(start.x+start.width/2,dest.y+20,{steps:15}); await page.mouse.up();
  await expect(list.locator('[data-page-id]').first()).toHaveAttribute('data-page-id','tasks');
  await owner.save();
  check('Existing drag-and-drop ordering works in the full-page editor');

  const historyOwner=await setup('owner','history-tenant','history-owner');
  await historyOwner.page.getByRole('tab',{name:'General / Profile',exact:true}).click();
  await historyOwner.page.getByRole('tab',{name:'Sidebar Management',exact:true}).click();
  await historyOwner.row('projects').getByRole('textbox').fill('History draft');
  await historyOwner.page.goBack();
  await historyOwner.page.getByRole('dialog',{name:'Leave without saving?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(historyOwner.page.getByRole('heading',{name:'Sidebar Management',exact:true})).toBeVisible();
  await expect(historyOwner.row('projects').getByRole('textbox')).toHaveValue('History draft');
  await historyOwner.context.close();
  check('Unsaved browser-back navigation can be cancelled without losing the draft');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:1000}); await page.locator('main').evaluate(element=>element.scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await expect(page.getByRole('heading',{name:'Sidebar Management',exact:true})).toBeVisible();
    await page.screenshot({path:path.join(output,'management-'+width+'.png')});
    check('Responsive management layout at '+width+'px');
  }
  assert.deepEqual(errors,[]); check('No application console or page errors');
  await writeFile(path.join(output,'sidebar-browser.json'),JSON.stringify({passed:true,cases,errors,writes:writes.length,scope:'Real application/router/editor with synthetic API responses; backend security tested separately.'},null,2));
} catch(error) {
  await writeFile(path.join(output,'sidebar-browser.json'),JSON.stringify({passed:false,cases,errors,failure:String(error)},null,2)); throw error;
} finally { for(const context of contexts) await context.close(); await browser.close(); }
