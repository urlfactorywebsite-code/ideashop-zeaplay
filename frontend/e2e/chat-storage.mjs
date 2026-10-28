// Local production UI with synthetic APIs and real PNG bytes. No real messages.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { navigationDocument } from './navigation-fixture.mjs';

const base = process.env.ZEAPLAY_CHAT_TEST_URL || 'http://127.0.0.1:16320';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Loopback only');
const { chromium, expect: rawExpect } = await import(pathToFileURL(process.env.ZEAPLAY_PLAYWRIGHT_MODULE).href);
const expect = rawExpect.configure({ timeout: 15000 });
const output = new URL('../../docs/chat-storage/', import.meta.url);
await mkdir(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ZkAAAAASUVORK5CYII=', 'base64');
const limit = 200 * 1024 * 1024;
const now = '2026-10-28T04:55:00Z';
const user = { id: 'self', name: 'Storage Reviewer', tenant_id: 'storage-fixture', role: 'owner', status: 'ACTIVE', email: 'self@example.test' };
const members = [user, { id: 'peer', name: 'Colleague', email: 'peer@example.test' }].map(item => ({
  user_id: item.id, name: item.name, email: item.email, role: 'MEMBER', app_role: 'user', account_status: 'ACTIVE', joined_at: now,
}));
const conversation = { id: 'image-room', tenant_id: user.tenant_id, name: 'Image room', type: 'GROUP', members,
  created_at: now, updated_at: now, is_private: true, unread_count: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
const passed = [], errors = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN', reducedMotion: 'reduce' });
    const uploads = new Map(), messages = [], deletes = [];
    let serial = 0, uploadAttempts = 0, authenticatedContent = 0;
    const used = () => [...uploads.values()].reduce((sum, row) => sum + row.file_size, 0);
    const storage = offset => ({ used_bytes: used(), limit_bytes: limit, remaining_bytes: Math.max(0, limit - used()), max_file_bytes: limit,
      file_count: uploads.size, has_more: false, items: [...uploads.values()].map(row => ({
        id: row.upload_id, original_file_name: row.original_file_name, mime_type: row.mime_type,
        file_size: row.file_size, created_at: now, attached: messages.some(message => message.attachments.some(file => file.storage_key === row.storage_key)),
      })).sort((a, b) => b.file_size - a.file_size).slice(offset) });
    const fillStorage = () => uploads.set('older-archive', { upload_id: 'older-archive', original_file_name: 'older-archive.zip', file_size: limit - used(), mime_type: 'application/zip', storage_key: 'older-archive' });
    await context.routeWebSocket('**/*', socket => socket.close({ code: 1008 }));
    await context.addInitScript(origin => { window.__RUNTIME_CONFIG__ = { API_URL: '/api', PRESENCE_URL: origin, WS_URL: origin + '/api' }; }, base);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (url.pathname.endsWith('/auth/browser-session/refresh')) return route.fulfill({ json: { access_token: 'synthetic-storage-session' } });
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: user });
      if (url.pathname === '/api/navigation') return route.fulfill({ json: navigationDocument('owner') });
      if (url.pathname === '/api/users') return route.fulfill({ json: [user] });
      if (url.pathname === '/api/chat/conversations') return route.fulfill({ json: [conversation] });
      if (url.pathname === '/api/chat/users') return route.fulfill({ json: { items: [], next_cursor: null } });
      if (url.pathname === '/api/chat/storage') return route.fulfill({ json: storage(Number(url.searchParams.get('offset') || 0)) });
      if (url.pathname.startsWith('/api/chat/storage/') && request.method() === 'DELETE') {
        const id = url.pathname.split('/').at(-1), upload = uploads.get(id);
        assert.ok(upload);
        deletes.push(id); uploads.delete(id);
        for (const message of messages) {
          message.attachments = message.attachments.filter(file => file.storage_key !== upload.storage_key);
          if (!message.content && !message.attachments.length) message.content = 'Attachment removed during storage cleanup';
        }
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === '/api/chat/conversations/image-room/attachments') {
        uploadAttempts++;
        assert.match(request.headers()['content-type'], /multipart\/form-data; boundary=/);
        assert.ok(request.postDataBuffer().includes(png), 'Multipart request must contain the selected image bytes');
        if (used() + png.length > limit) return route.fulfill({ status: 413, json: { detail: {
          code: 'CHAT_STORAGE_QUOTA_EXCEEDED', message: 'Your 200 MB chat storage limit would be exceeded. Clean up storage to upload this file.',
        } } });
        const id = `upload-${++serial}`;
        const name = request.postDataBuffer().toString('latin1').match(/filename="([^"]+)"/)[1];
        const row = { upload_id: id, file_name: `${id}.png`, original_file_name: name, mime_type: 'image/png', file_size: png.length,
          storage_key: `chat/${id}.png`, url: `/chat/uploads/${id}/content` };
        uploads.set(id, row);
        return route.fulfill({ json: row });
      }
      if (/^\/api\/chat\/(uploads|attachments)\/[^/]+\/content$/.test(url.pathname)) {
        assert.ok(request.headers().authorization, 'File bytes must load through authenticated API requests');
        authenticatedContent++;
        return route.fulfill({ contentType: 'image/png', body: png });
      }
      if (url.pathname === '/api/chat/conversations/image-room/messages') {
        if (request.method() === 'POST') {
          const payload = request.postDataJSON();
          assert.equal(payload.message_type, 'IMAGE');
          const row = { ...payload, id: `message-${messages.length + 1}`, conversation_id: conversation.id, sender_id: user.id,
            sender_name: user.name, created_at: now, updated_at: now, reactions: [], attachments: payload.attachments.map(file => ({
              ...file, id: `attachment-${messages.length + 1}`, message_id: `message-${messages.length + 1}`, url: `/chat/attachments/attachment-${messages.length + 1}/content`, created_at: now,
            })) };
          messages.push(row);
          return route.fulfill({ status: 201, json: row });
        }
        return route.fulfill({ json: { items: messages, has_more: false, next_cursor: null } });
      }
      if (url.pathname.endsWith('/work/active')) return route.fulfill({ json: { items: [], running_count: 0, limit: 5, server_time: now, user_id: user.id, tenant_id: user.tenant_id } });
      if (url.pathname.endsWith('/notifications/stream')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/chat/image-room');
    const composer = page.getByPlaceholder(/^Message #image-room/);
    await expect(composer).toBeVisible();
    const choose = name => page.getByLabel('Choose chat images').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    await choose('photo.png');
    await expect(page.getByAltText('photo.png')).toBeVisible();
    await expect.poll(() => page.getByAltText('photo.png').evaluate(image => image.naturalWidth)).toBe(1);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('#msg-message-1').getByAltText('photo.png')).toBeVisible();
    await page.reload();
    await expect(page.locator('#msg-message-1').getByAltText('photo.png')).toBeVisible();
    await expect.poll(() => page.locator('#msg-message-1 img').evaluate(image => image.naturalWidth)).toBe(1);
    assert.ok(authenticatedContent >= 2);
    passed.push(`Image picker, multipart bytes, authenticated preview, image-only send and history reload (${width}px)`);
    // Paste a real clipboard image and remove its draft to release storage.
    await composer.evaluate((element, bytes) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'clipboard.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    }, [...png]);
    await expect(page.getByAltText('clipboard.png')).toBeVisible();
    await page.getByRole('button', { name: 'Remove clipboard.png', exact: true }).click();
    await expect(page.getByAltText('clipboard.png')).toHaveCount(0);
    assert.equal(used(), png.length);
    fillStorage(); // Another tab fills storage; the UI still has a stale smaller usage.
    await choose('blocked.png');
    const modal = page.getByRole('dialog', { name: 'Chat storage', exact: true });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('200 MB / 200 MB used')).toBeVisible();
    await modal.getByRole('button', { name: 'Delete older-archive.zip', exact: true }).click();
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(uploads.has('older-archive'), 'Cleanup requires an explicit choice');
    await page.screenshot({ path: fileURLToPath(new URL(`storage-full-${width}.png`, output)), fullPage: true });
    await modal.getByRole('button', { name: 'Close storage', exact: true }).click();
    const beforePreflight = uploadAttempts;
    await choose('blocked-again.png');
    await expect(modal).toBeVisible();
    assert.equal(uploadAttempts, beforePreflight, 'Known full usage must prompt cleanup before uploading');
    await modal.getByRole('button', { name: 'Delete older-archive.zip', exact: true }).click();
    await modal.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(modal.getByText(/available.*1 files/)).toBeVisible();
    await modal.getByRole('button', { name: 'Close storage', exact: true }).click();
    await choose('after.png');
    await expect(page.getByAltText('after.png')).toBeVisible();
    await composer.fill('Photo after cleanup');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('#msg-message-2').getByAltText('after.png')).toBeVisible();
    passed.push(`Clipboard image, pending-file removal, stale-server quota rejection, local quota prompt, explicit cleanup and retry (${width}px)`);
    await page.getByRole('button', { name: 'Manage storage', exact: true }).click();
    await modal.getByRole('button', { name: 'Delete photo.png', exact: true }).click();
    await modal.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(modal.getByText(/available.*1 files/)).toBeVisible();
    await modal.getByRole('button', { name: 'Close storage', exact: true }).click();
    await expect(page.locator('#msg-message-1').getByText('Attachment removed during storage cleanup', { exact: true })).toBeVisible();
    await expect(page.locator('#msg-message-2').getByText('Photo after cleanup', { exact: true })).toBeVisible();
    await expect(page.locator('#msg-message-2').getByAltText('after.png')).toBeVisible();
    assert.equal(used(), png.length);
    assert.equal(messages.length, 2);
    await page.screenshot({ path: fileURLToPath(new URL(`chat-images-${width}.png`, output)), fullPage: true });
    passed.push(`Shared-image cleanup removes chosen bytes while preserving text and other images (${width}px)`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { environment: 'Local production build, synthetic REST APIs, real 1x1 PNG bytes, no real messages or production storage', passed, errors };
  await writeFile(new URL('browser.json', output), JSON.stringify(report, null, 2) + '\n');
  passed.forEach(item => console.log('PASS: ' + item));
} finally { await browser.close(); }
