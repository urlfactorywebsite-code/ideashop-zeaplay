import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const { chromium, expect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const base = process.env.ZEAPLAY_CREATE_TASK_TEST_URL || 'http://127.0.0.1:16319';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback only');
const output = new URL('../../.tmp/task-attachments/', import.meta.url);
await mkdir(output, { recursive: true });
const tailwind = await readFile(new URL('../../docs/push-notifications/checks/tailwind-test-runtime.js', import.meta.url));

function png() {
  const chunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ -1) >>> 0);
    return Buffer.concat([length, content, checksum]);
  };
  const width = 640, height = 360, header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4; rows[offset] = 35 + Math.floor(x / 4); rows[offset + 1] = 80 + Math.floor(y / 3); rows[offset + 2] = 210; rows[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function pdf() {
  const stream = 'BT /F1 24 Tf 55 735 Td (Attachment preview verification) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = body.length; body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
const fixtures = new Map([
  ['Design.png', { mimeType: 'image/png', buffer: png() }],
  ['Specification.pdf', { mimeType: 'application/pdf', buffer: pdf() }],
  ['Notes.txt', { mimeType: 'text/plain', buffer: Buffer.from('Attachment notes\n<script>window.__attachmentExecuted = true</script>') }],
  ['Budget.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK unsupported office test') }],
  ['Email.eml', { mimeType: 'message/rfc822', buffer: Buffer.from('From: example@example.test\nSubject: Review\n\nPlease review the attachment.') }],
  ['Disguised.pdf', { mimeType: 'application/pdf', buffer: Buffer.from('<html><script>window.__attachmentExecuted = true</script></html>') }],
]);
await writeFile(new URL('preview-verification.pdf', output), pdf());
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.ZEAPLAY_ATTACHMENTS_HEADED !== '1' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  window.__attachmentUrls = new Set();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); window.__attachmentUrls.add(url); return url; };
  URL.revokeObjectURL = url => { window.__attachmentUrls.delete(url); return revoke(url); };
});
await context.routeWebSocket('**/api/ws/**', socket => socket.close());
let saved = null, failMedia = true;
const errors = [], results = [];
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
  if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: tailwind });
  if (url.origin !== base) return route.abort();
  if (['/__attachments', '/__attachment-detail'].includes(url.pathname)) {
    const response = await route.fetch({ url: base + '/' });
    const fixture = url.pathname === '/__attachments' ? 'createTaskModalFixture' : 'subtaskEditorFixture';
    return route.fulfill({ response, body: (await response.text()).replace(/src="\/index\.tsx[^"]*"/, `src="/e2e/${fixture}.tsx"`) });
  }
  if (url.pathname === '/api/media/upload') {
    const name = request.postDataBuffer().toString().match(/filename="([^"]+)"/)?.[1];
    assert.ok(fixtures.has(name));
    return route.fulfill({ status: 201, json: { public_url: '/media/' + encodeURIComponent(name) } });
  }
  if (url.pathname.startsWith('/media/')) {
    const name = decodeURIComponent(url.pathname.split('/').at(-1));
    if (name === 'Missing.pdf') return failMedia ? route.fulfill({ status: 404, body: 'Missing' }) : route.fulfill({ contentType: 'application/pdf', body: pdf() });
    const file = fixtures.get(name);
    return file ? route.fulfill({ contentType: file.mimeType, body: file.buffer }) : route.fulfill({ status: 404, body: 'Missing' });
  }
  const task = { id: 'subtask-parent', title: saved?.title || 'Attachment task', description: '', status: 'TODO', priority: 'LOW',
    assigned_to_id: 'reviewer', created_by_id: 'reviewer', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    subtasks: [], attachments: saved?.attachments || [], tags: [], can_edit: true, can_manage_subtasks: true, can_review_subtasks: true };
  if (url.pathname === '/api/kanban-columns') return route.fulfill({ json: [{ id: 'WAITING_FOR_REQUIREMENT', title: 'New Task', order: 0, is_active: true }] });
  if (url.pathname === '/api/tasks' && request.method() === 'POST') { saved = request.postDataJSON(); return route.fulfill({ status: 201, json: [{ ...task, attachments: saved.attachments }] }); }
  if (url.pathname === '/api/tasks/subtask-parent' && request.method() === 'GET') return route.fulfill({ json: task });
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
  return route.continue();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const preview = () => page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close attachment preview', exact: true }) });
const open = name => page.getByRole('button', { name: 'Preview attachment ' + name, exact: true });
const close = async name => { await page.getByRole('button', { name: 'Close attachment preview', exact: true }).click(); await expect(preview()).toHaveCount(0); await expect(open(name)).toBeFocused(); };
const pass = name => { results.push(name); console.log('PASS: ' + name); };
const screenshot = name => page.screenshot({ path: new URL(name + '.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
const pdfReady = () => expect.poll(async () => {
  for (const frame of page.frames()) {
    if (!frame.url().startsWith('blob:')) continue;
    const ready = await frame.evaluate(() => !!document.querySelector('embed[type="application/x-google-chrome-pdf"]') &&
      (document.querySelector('#sizer')?.getBoundingClientRect().height || 0) > 0).catch(() => false);
    if (ready) return true;
  }
  return false;
}, { timeout: 15000, message: 'Native PDF viewer loads a page with nonzero dimensions' }).toBe(true);
try {
  await page.goto(base + '/__attachments');
  await page.locator('#title').fill('Typed attachment task');
  for (const [name, file] of fixtures) {
    await page.locator('input[type=file]').setInputFiles({ name, ...file });
    await expect(open(name)).toBeVisible();
  }
  await expect(page.locator('.task-attachment-type')).toHaveText(['PNG', 'PDF', 'TXT', 'DOCX', 'EML', 'PDF']);
  await expect(page.locator('.task-attachment-icon img')).toBeVisible();
  await screenshot('attachment-cards');
  const cardUrls = await page.evaluate(() => window.__attachmentUrls.size);
  await open('Design.png').click();
  await expect(preview().getByRole('img', { name: 'Design.png' })).toBeVisible();
  await expect.poll(() => preview().getByRole('img').evaluate(el => el.naturalWidth)).toBe(640);
  assert.equal(context.pages().length, 1);
  await screenshot('image-preview');
  await page.keyboard.press('Escape');
  await expect(preview()).toHaveCount(0); await expect(open('Design.png')).toBeFocused();
  assert.equal(await page.locator('#title').inputValue(), 'Typed attachment task');
  assert.equal(await page.evaluate(() => window.__attachmentUrls.size), cardUrls);
  await open('Specification.pdf').click();
  await expect(preview().locator('iframe')).toBeVisible();
  await expect(preview().locator('iframe')).toHaveAttribute('src', /^blob:/);
  await pdfReady(); await screenshot('pdf-preview');
  await close('Specification.pdf');
  assert.equal(await page.evaluate(() => window.__attachmentUrls.size), cardUrls);
  pass('Compact file-type cards, image thumbnail, decoded in-page image, PDF viewer, no new tab, Escape/focus restoration and URL cleanup');

  for (const [name, text] of [['Notes.txt', '<script>window.__attachmentExecuted'], ['Email.eml', 'Subject: Review']]) {
    await open(name).click(); await expect(preview().locator('pre')).toContainText(text); await close(name);
  }
  assert.equal(await page.evaluate(() => window.__attachmentExecuted), undefined);
  for (const name of ['Budget.docx', 'Disguised.pdf']) {
    await open(name).click(); await expect(preview()).toContainText('In-page preview is not available');
    await expect(preview().locator('iframe')).toHaveCount(0); await expect(preview().getByRole('link', { name: 'Download file' })).toBeVisible(); await close(name);
  }
  pass('Text/email display safely; unsupported office files and disguised HTML offer original/download without embedding active content');

  await page.getByLabel('Attachment link', { exact: true }).fill(base + '/media/Missing.pdf');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await open('Missing.pdf').click(); await expect(preview().getByRole('alert')).toContainText('Unable to load');
  failMedia = false; await preview().getByRole('button', { name: 'Retry preview' }).click();
  await expect(preview().locator('iframe')).toBeVisible(); await close('Missing.pdf');
  await page.getByRole('button', { name: 'Remove attachment 7', exact: true }).click();
  await expect(open('Missing.pdf')).toHaveCount(0); await expect(preview()).toHaveCount(0);
  pass('Linked file preview, load failure/retry and removal preserve the draft');

  await page.setViewportSize({ width: 320, height: 740 });
  const bounds = await page.locator('.task-attachment-grid').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
  assert.ok(bounds.content <= bounds.width + 1);
  await open('Design.png').click(); const box = await page.locator('.task-attachment-preview-panel').boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 740, JSON.stringify(box));
  await screenshot('mobile-preview'); await close('Design.png');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create task', exact: true })).toHaveCount(0);
  assert.deepEqual(saved.attachments, [...fixtures.keys()].map(name => '/media/' + encodeURIComponent(name)));
  assert.equal(await page.evaluate(() => window.__attachmentUrls.size), 0);
  pass('320px layout and preview fit the viewport; task creation keeps the existing URL-array payload and releases local files');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/__attachment-detail');
  await expect(open('Design.png')).toBeVisible(); await open('Design.png').click();
  await expect(preview().getByRole('img', { name: 'Design.png' })).toBeVisible(); await close('Design.png');
  await page.reload(); await open('Specification.pdf').click(); await expect(preview().locator('iframe')).toBeVisible(); await pdfReady(); await close('Specification.pdf');
  await expect(page.getByRole('dialog', { name: 'Quest details', exact: true })).toBeVisible();
  pass('Saved Task Detail attachments keep file-type cards and in-page previews after refresh');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('results.json', output), JSON.stringify({ results, errors, savedAttachments: saved?.attachments }, null, 2));
  await browser.close();
}
