import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Avatar, { avatarColor, avatarInitials } from '../components/Avatar';
import EmployeeIdentityCard from '../components/EmployeeIdentityCard';
import SkillsEditor, { normalizeSkills } from '../components/SkillsEditor';
import { getFrameClassName } from '../constants/avatarFrames';
import { clearProfileCache, latestProfile, publishAvatarAsset, publishProfile } from '../services/profileEvents';
import { AvatarAsset, Role, User, UserStatus } from '../types';
import { createAvatarImageCache } from '../services/avatarResources';
import { getUserAvatarUrl } from '../utils/userAvatar';
import ProfileMediaEditor from '../components/ProfileMediaEditor';

const user = { id: 'employee', tenantId: 'tenant-a', name: 'Priya Shah', email: 'priya@example.com', role: Role.USER, status: UserStatus.ACTIVE, skills: ['React'], profileBio: 'First line\n<script>alert(1)</script>' } as User;
test('employee card uses existing designation and safe text without inventing employee data', () => {
  const html = renderToStaticMarkup(<EmployeeIdentityCard user={user} />);
  assert.match(html, /Not assigned/);
  assert.match(html, /Designation not set/);
  assert.match(html, /&lt;script&gt;/);
  assert(!html.includes('<script>'));
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /Priya Shah/);
});
test('default avatars are accessible, deterministic and share frame styles', () => {
  assert.equal(avatarInitials(' Priya  Shah '), 'PS');
  assert.equal(avatarInitials(''), '?');
  assert.equal(avatarColor(user.id), avatarColor(user.id));
  for (const frame of ['classic', 'aurora', 'solar', 'emerald', 'role-ring', 'achievement-glow', 'minimal']) {
    const html = renderToStaticMarkup(<Avatar user={{ ...user, avatarFrame: frame }} />);
    assert(html.includes(getFrameClassName(frame, Role.USER)));
    assert.match(html, /role="img"/);
  }
});
test('skills editor provides named remove controls and deduplicated suggestions', () => {
  assert.deepEqual(normalizeSkills(['React', 'react', ' Python ']), ['react', 'Python']);
  const html = renderToStaticMarkup(<SkillsEditor value={['React']} suggestions={['React', 'Python']} onChange={() => {}} />);
  assert.match(html, /Remove React/);
  assert.match(html, /Search or add a skill/);
  assert.match(html, /value="Python"/);
  assert(!html.includes('value="React"'));
});
test('avatar state discards stale responses and is cleared between sessions', () => {
  clearProfileCache();
  publishProfile({ ...user, updatedAt: '2026-10-21T12:00:00', avatarUrl: '/new' });
  assert.equal(publishProfile({ ...user, updatedAt: '2026-10-20T12:00:00', avatarUrl: '/old' }).avatarUrl, '/new');
  assert.equal(latestProfile(user.id)?.avatarUrl, '/new');
  clearProfileCache();
  assert.equal(latestProfile(user.id), undefined);
});

test('avatar removal overrides legacy fields and every existing frame remains selectable', () => {
  assert.equal(getUserAvatarUrl({ avatarUrl: null, profileImageUrl: '/old' }), null);
  assert.equal(getUserAvatarUrl({ avatarUrl: '/new', profileImageUrl: '/old' }), '/new');
  assert.equal(getUserAvatarUrl({ profileImageUrl: '/legacy' }), '/legacy');
  const html = renderToStaticMarkup(<ProfileMediaEditor user={user} onSaved={() => {}} />);
  for (const label of ['Classic Slate', 'Aurora Neon', 'Solar Flare', 'Emerald Crest', 'Role ring', 'Achievement glow', 'Minimal']) {
    assert(html.toLowerCase().includes(label.toLowerCase()), label);
  }
});

test('missing employee values produce explicit empty states without crashing', () => {
  const html = renderToStaticMarkup(<EmployeeIdentityCard user={{ id: 'missing' } as User} />);
  for (const text of ['Name not provided', 'Role not set', 'Status not set', 'Not assigned', 'No professional bio']) assert(html.includes(text));
  assert(!html.includes('undefined'));
});

test('image requests are shared by version and size and cleared between sessions', async () => {
  let requests = 0;
  const cache = createAvatarImageCache(async () => { requests++; return new Blob(['image']); });
  const first = cache.acquire('/api/avatars/a/image?v=1', 128);
  const duplicate = cache.acquire('/api/avatars/a/image?v=1', 128);
  assert.equal(await first.promise, await duplicate.promise);
  assert.equal(requests, 1);
  const display = cache.acquire('/api/avatars/a/image?v=1', 512);
  const replacement = cache.acquire('/api/avatars/b/image?v=2', 128);
  await Promise.all([display.promise, replacement.promise]);
  assert.equal(requests, 3);
  first.release(); duplicate.release(); display.release(); replacement.release();
  const remount = cache.acquire('/api/avatars/a/image?v=1', 128);
  assert.equal(await remount.promise, await first.promise);
  assert.equal(requests, 3);
  remount.release(); cache.clear();
  const nextSession = cache.acquire('/api/avatars/a/image?v=1', 128);
  assert.notEqual(await nextSession.promise, await first.promise);
  assert.equal(requests, 4);
  nextSession.release(); cache.clear();
});

test('image cache bounds idle memory, retries failures and rejects a pending old session', async () => {
  let requests = 0;
  const cache = createAvatarImageCache(async () => { requests++; return new Blob(['image']); }, 1);
  for (const source of ['/a', '/b', '/c']) { const value = cache.acquire(source, 128); await value.promise; value.release(); }
  const evicted = cache.acquire('/a', 128); await evicted.promise; evicted.release();
  assert.equal(requests, 4); cache.clear();
  let finish!: (blob: Blob) => void;
  const pendingCache = createAvatarImageCache(() => new Promise<Blob>(resolve => { finish = resolve; }));
  const pending = pendingCache.acquire('/pending', 128);
  pendingCache.clear(); finish(new Blob(['private']));
  await assert.rejects(pending.promise, /session ended/); pending.release();
  let attempts = 0;
  const failing = createAvatarImageCache(async () => { if (++attempts === 1) throw Error('offline'); return new Blob(['image']); });
  const failed = failing.acquire('/retry', 128); await assert.rejects(failed.promise, /offline/); failed.release();
  const retry = failing.acquire('/retry', 128); await retry.promise; retry.release(); failing.clear();
  assert.equal(attempts, 2);
});

test('library replacements publish immediately and old user snapshots cannot restore the old image', () => {
  clearProfileCache();
  const asset = { id: 'library-avatar', url: '/old', updatedAt: '2026-10-21T12:00:00' } as AvatarAsset;
  const assigned = { ...user, avatarAssetId: asset.id, avatarAsset: asset, avatarUrl: '/old', updatedAt: '2026-10-21T11:00:00' };
  publishProfile(assigned);
  publishAvatarAsset({ ...asset, url: '/new', updatedAt: '2026-10-21T13:00:00' });
  assert.equal(latestProfile(user.id)?.avatarUrl, '/new');
  assert.equal(publishProfile(assigned).avatarUrl, '/new');
  clearProfileCache();
});
