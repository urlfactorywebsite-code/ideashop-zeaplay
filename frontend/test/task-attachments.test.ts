import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentBytes, attachmentInfo, attachmentPreviewMime, safeAttachmentUrl } from '../utils/taskAttachments';

test('attachment cards derive names and file types without query strings or fragments', () => {
  const info = attachmentInfo('https://files.example.test/design%20review.PNG?token=hidden#page=2');
  assert.equal(info.name, 'design review.PNG');
  assert.equal(info.label, 'PNG');
  assert.equal(info.kind, 'image');
  assert.equal(attachmentInfo('/media/generated.bin', { name: 'Original brief', type: 'application/pdf', size: 2048 }).label, 'PDF');
  assert.equal(attachmentInfo('/mail/message.eml').description, 'Email');
  assert.equal(attachmentInfo('https://example.test/brief').label, 'LINK');
  assert.equal(attachmentInfo('/media/plan.docx').label, 'DOCX');
  assert.equal(attachmentInfo('/media/%invalid').name, 'Attachment');
  assert.equal(attachmentBytes(2048), '2.0 KB');
});

test('attachment links reject executable and opaque URL schemes', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/test.pdf', 'blob:https://example.test/id']) {
    assert.equal(safeAttachmentUrl(value), null);
  }
  assert.equal(safeAttachmentUrl('/media/a.pdf', 'https://app.example.test/tasks'), 'https://app.example.test/media/a.pdf');
  assert.equal(safeAttachmentUrl('https://files.example.test/a.pdf'), 'https://files.example.test/a.pdf');
});

test('inline viewers use verified bytes rather than an untrusted extension or MIME header', async () => {
  assert.equal(await attachmentPreviewMime(new Blob(['%PDF-1.7\n'], { type: 'application/octet-stream' })), 'application/pdf');
  assert.equal(await attachmentPreviewMime(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])])), 'image/png');
  assert.equal(await attachmentPreviewMime(new Blob(['GIF89a'])), 'image/gif');
  assert.equal(await attachmentPreviewMime(new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' })), null);
  assert.equal(await attachmentPreviewMime(new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' })), null);
});
