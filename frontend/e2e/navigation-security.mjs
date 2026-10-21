// Actual login UI and signed backend sessions. Only unrelated layout reads are synthetic.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_SECURITY_FRONTEND_URL;
const backend = process.env.ZEAPLAY_SECURITY_BACKEND_URL;
for (const url of [base, backend]) if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('Disposable loopback services only');
const accounts = JSON.parse(process.env.ZEAPLAY_SECURITY_ACCOUNTS);
const output = process.env.ZEAPLAY_SECURITY_OUTPUT;
await mkdir(output, { recursive: true });
const tailwind = await readFile(process.env.ZEAPLAY_TAILWIND_JS);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [], cases = [], errors = [], requests = [];
const check = (name, evidence = {}) => { cases.push({ case: name, passed: true, ...evidence }); console.log('PASS ' + name); };
async function setup(role) {
  const context = await browser.newContext({ viewport: { width:1440, height:1000 }, reducedMotion:'reduce' });
  contexts.push(context);
  await context.addInitScript(() => localStorage.setItem('zenith-task-theme', 'dark'));
  await context.routeWebSocket('**/api/ws/**', socket => socket.close({ code:1000 }));
  await context.routeWebSocket(url => url.host === new URL(base).host && url.pathname === '/', socket => {
    socket.send(JSON.stringify({ type:'connected' })); socket.onMessage(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ role, message:error.message }));
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 500) errors.push({ role, message:'HTTP '+response.status(), path:new URL(response.url()).pathname }); });
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push({ role, message:message.text() }); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType:'text/javascript', body:tailwind });
    if (url.origin === base) {
      if (url.pathname === '/__navigation-security') {
        const response = await route.fetch({ url:base+'/' });
        return route.fulfill({ response, body:(await response.text()).replace(/src="\/index\.tsx[^"]*"/, 'src="/e2e/navigationSecurityFixture.tsx"') });
      }
      if (['/pages/Dashboard.tsx','/pages/Tasks.tsx'].includes(url.pathname)) return route.fulfill({ contentType:'text/javascript', body:'export default function Page(){return "Synthetic unrelated landing page"}' });
      if (/^\/api\/(auth|navigation|config|oauth2|integrations|webhooks)(\/|$)/.test(url.pathname)) {
        const response = await route.fetch({ url:backend+url.pathname+url.search });
        requests.push({ role, method:route.request().method(), path:url.pathname, status:response.status() });
        return route.fulfill({ response });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill(url.pathname.endsWith('/notifications/stream') ? { contentType:'text/event-stream', body:'' } : { json:[] });
      return route.continue();
    }
    if (['res.cloudinary.com','storage.googleapis.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const go = target => page.goto(base+'/__navigation-security#'+target);
  const api = (method, endpoint, body) => page.evaluate(async ({ method, endpoint, body }) => {
    const { http } = await import('/services/mockApi.ts');
    try { const response = await http.request({ method, url:endpoint, data:body }); return { status:response.status, data:response.data }; }
    catch(error) { return { status:error.response?.status || 0 }; }
  }, { method, endpoint, body });
  const login = async () => {
    await go('/settings/profile');
    await expect(page.locator('#email-address')).toBeVisible({ timeout:30000 });
    await page.locator('#email-address').fill(accounts[role].email);
    await page.locator('#password').fill(accounts[role].password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible({timeout:30000});
  };
  const logout = async () => {
    await page.getByRole('button',{name:new RegExp('Navigation '+role,'i')}).click();
    await page.getByRole('button',{name:'Logout',exact:true}).click();
    await expect(page.locator('#email-address')).toBeVisible();
  };
  await login();
  return { page, context, go, api, login, logout };
}
try {
  const owner = await setup('owner');
  const { page } = owner;
  await page.getByRole('tab',{name:'Sidebar Management',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Enable Settings',exact:true})).toBeChecked();
  await expect(page.getByRole('switch',{name:'Enable Settings',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Settings Page Tabs',exact:true}).click();
  const apiRow = page.locator('[data-page-id="settings.api"]');
  await apiRow.getByRole('switch').check();
  await apiRow.locator('summary').click();
  await apiRow.getByRole('checkbox',{name:'API: owner',exact:true}).check();
  await apiRow.getByRole('checkbox',{name:'API: admin',exact:true}).check();
  for(const role of ['user','manager']) await expect(apiRow.getByRole('checkbox',{name:'API: '+role,exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await expect(page.getByRole('tab',{name:'API',exact:true})).toBeVisible();
  check('OWNER saves enabled Settings/API with only OWNER and ADMIN, using real authenticated policy PUT');

  await owner.logout(); await owner.login();
  await expect(page.getByRole('tab',{name:'API',exact:true})).toBeVisible();
  const sessions = { owner, admin:await setup('admin'), manager:await setup('manager'), user:await setup('user') };
  for(const [role, fixture] of Object.entries(sessions)) {
    await expect(fixture.page.getByRole('tab',{name:'API',exact:true})).toHaveCount(['owner','admin'].includes(role) ? 1 : 0);
    const management = await fixture.api('GET','/oauth2/clients');
    assert.equal(management.status,['owner','admin'].includes(role) ? 200 : 403);
    check(role.toUpperCase()+' actual login: API navigation and OAuth management permission agree',{oauth_management_status:management.status});
  }
  await sessions.admin.page.getByRole('tab',{name:'OAuth',exact:true}).click();
  await expect(sessions.admin.page.getByRole('heading',{name:'OAuth management',exact:true})).toBeVisible();
  for(const role of ['manager','user']) {
    const fixture = sessions[role];
    await fixture.go('/settings/api');
    await expect(fixture.page.getByRole('heading',{name:'Access forbidden',exact:true})).toBeVisible();
    await fixture.go('/settings/api/oauth/authorized-apps');
    await expect(fixture.page.getByRole('heading',{name:'Authorized applications',exact:true})).toBeVisible();
    const statuses = {};
    for(const endpoint of ['/config/api','/config/smtp/multiple','/integrations/n8n/config','/webhooks']) statuses[endpoint]=(await fixture.api('GET',endpoint)).status;
    assert.ok(Object.values(statuses).every(status=>status===403));
    const readable = await fixture.api('GET','/navigation');
    const attempted = { revision:readable.data.revision, pages:readable.data.pages.map(({id,enabled,hidden,allowedRoles,sortOrder})=>({id,enabled,hidden,allowedRoles,sortOrder})) };
    assert.equal((await fixture.api('PUT','/navigation',attempted)).status,403);
    await fixture.go('/oauth/applications');
    await expect(fixture.page.getByRole('heading',{name:'Authorized applications',exact:true})).toBeVisible();
    check(role.toUpperCase()+' cannot bypass API via direct/nested routes or configuration requests; own grants remain independent',{statuses});
    await fixture.go('/settings/profile');
  }
  await sessions.admin.go('/settings/profile');
  await page.getByRole('tab',{name:'Sidebar Management',exact:true}).click();
  await page.getByRole('button',{name:'Settings Page Tabs',exact:true}).click();
  const oauthRow = page.locator('[data-page-id="settings.oauth"]');
  await oauthRow.getByRole('switch').uncheck();
  await apiRow.getByRole('switch').uncheck();
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  // No synthetic focus event: the existing visible session must revalidate on its timer.
  await expect(sessions.admin.page.getByRole('tab',{name:'API',exact:true})).toHaveCount(0,{timeout:22000});
  for(const [role, fixture] of Object.entries(sessions)) {
    const config = await fixture.api('GET','/navigation');
    assert.equal(config.data.pages.find(page=>page.id==='settings.api').enabled,false);
    assert.equal((await fixture.api('GET','/oauth2/clients')).status,403);
    await expect(fixture.page.getByRole('tab',{name:'API',exact:true})).toHaveCount(0);
    check(role.toUpperCase()+' loses API navigation and server management access after independent API and OAuth disable');
  }
  check('Authenticated polling updates another active browser session without a new WebSocket channel');

  await oauthRow.getByRole('switch').check();
  await apiRow.getByRole('switch').check();
  await apiRow.locator('summary').click();
  await expect(apiRow.getByRole('checkbox',{name:'API: admin',exact:true})).toBeChecked();
  await expect(apiRow.getByRole('checkbox',{name:'API: user',exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  for(const [role, fixture] of Object.entries(sessions)) {
    await fixture.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(fixture.page.getByRole('tab',{name:'API',exact:true})).toHaveCount(['owner','admin'].includes(role) ? 1 : 0);
    assert.equal((await fixture.api('GET','/oauth2/clients')).status,['owner','admin'].includes(role) ? 200 : 403);
  }
  check('Re-enabling restores API only to OWNER/ADMIN without expanding permissions');
  await sessions.manager.context.close(); await sessions.user.context.close();

  await owner.logout(); await owner.login(); await expect(page.getByRole('tab',{name:'API',exact:true})).toBeVisible();
  await sessions.admin.page.reload(); await expect(sessions.admin.page.getByRole('tab',{name:'API',exact:true})).toBeVisible({timeout:30000});
  const fresh = await setup('owner'); await expect(fresh.page.getByRole('tab',{name:'API',exact:true})).toBeVisible();
  check('Server policy survives logout/login, HttpOnly-session refresh and a fresh browser context');
  await page.screenshot({path:path.join(output,'owner-settings.png')});
  assert.deepEqual(errors,[]); check('No application console or page errors during real-session scenario');
  await writeFile(path.join(output,'real-session-browser.json'),JSON.stringify({passed:true,cases,errors,requests,scope:'Real Chrome login, JWT/HttpOnly sessions, policy persistence, OAuth/SMTP authorization on an isolated database. Unrelated layout reads are synthetic. No delivery sends.'},null,2));
} catch(error) {
  await writeFile(path.join(output,'real-session-browser.json'),JSON.stringify({passed:false,cases,errors,requests,failure:String(error)},null,2)); throw error;
} finally { for(const context of contexts) await context.close().catch(()=>{}); await browser.close(); }
