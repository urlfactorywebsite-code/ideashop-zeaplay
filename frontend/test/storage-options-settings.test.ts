import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('storage provider controls are moved from media library to settings', () => {
  const mediaLibrarySource = readFileSync(new URL('../pages/MediaLibrary.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../pages/ProfileSettings.tsx', import.meta.url), 'utf8');
  const storagePanelSource = readFileSync(new URL('../components/SettingsStorageOptionsPanel.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(mediaLibrarySource, /ProviderConnect/);
  assert.doesNotMatch(mediaLibrarySource, /connectMediaProvider/);

  assert.match(settingsSource, /SettingsStorageOptionsPanel/);
  assert.match(storagePanelSource, /Storage options/);
  assert.match(storagePanelSource, /MinIO storage/);
  assert.match(storagePanelSource, /Google Drive/);
  assert.match(storagePanelSource, /Supabase Storage/);
  assert.match(storagePanelSource, /OneDrive/);
  assert.match(storagePanelSource, /S3-compatible free options/);
});

test('storage live checks stay admin scoped and use existing providers', () => {
  const storagePanelSource = readFileSync(new URL('../components/SettingsStorageOptionsPanel.tsx', import.meta.url), 'utf8');

  assert.match(storagePanelSource, /userRole === Role\.OWNER \|\| userRole === Role\.ADMIN/);
  assert.match(storagePanelSource, /LIVE_PROVIDERS: StorageProvider\[\] = \['supabase', 'gdrive'\]/);
  assert.match(storagePanelSource, /api\.connectMediaProvider\(provider\)/);
  assert.match(storagePanelSource, /api\.startGoogleDriveOAuth\(\)/);
  assert.match(storagePanelSource, /window\.open\(/);
  assert.match(storagePanelSource, /GOOGLE_DRIVE_OAUTH_MESSAGE_TYPE/);
});
