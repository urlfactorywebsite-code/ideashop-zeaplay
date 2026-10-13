import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('tool library is launched from the header instead of sidebar navigation', () => {
  const sidebarSource = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8');
  const layoutSource = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
  const headerSource = readFileSync(new URL('../components/Header.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(sidebarSource, /to:\s*['"]\/tool-library['"]/);
  assert.doesNotMatch(layoutSource, /to:\s*['"]\/tool-library['"]/);
  assert.match(headerSource, /navigate\(['"]\/tool-library['"]\)/);
  assert.match(headerSource, /aria-label="Open Tool Library"/);
});
