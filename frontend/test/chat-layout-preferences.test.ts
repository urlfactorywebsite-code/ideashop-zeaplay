import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('chat aligns current-user messages right and incoming messages left', () => {
  const chatSource = readFileSync(new URL('../features/chat/ChatApp.tsx', import.meta.url), 'utf8');

  assert.match(chatSource, /isSelf \? 'justify-end' : 'justify-start'/);
  assert.match(chatSource, /isSelf \? 'flex-row-reverse' : ''/);
  assert.match(chatSource, /isSelf \? 'text-right' : 'text-left'/);
});

test('chat exposes a topbar background color picker persisted locally', () => {
  const chatSource = readFileSync(new URL('../features/chat/ChatApp.tsx', import.meta.url), 'utf8');

  assert.match(chatSource, /CHAT_BACKGROUND_STORAGE_KEY/);
  assert.match(chatSource, /localStorage\.setItem\(CHAT_BACKGROUND_STORAGE_KEY, color\)/);
  assert.match(chatSource, /aria-label="Change chat background"/);
  assert.match(chatSource, /type="color"/);
});
