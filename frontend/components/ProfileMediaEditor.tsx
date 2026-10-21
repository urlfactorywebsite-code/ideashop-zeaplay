import React, { useEffect, useRef, useState } from 'react';
import api, { http } from '../services/mockApi';
import { AvatarCropMetadata, User } from '../types';
import Avatar from './Avatar';
import AvatarCropModal from './AvatarCropModal';
import { FRAME_OPTIONS } from '../constants/avatarFrames';

export default function ProfileMediaEditor({ user, onSaved, self = true }: { user: User; onSaved: (user: User) => void; self?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [maxBytes, setMaxBytes] = useState(5 * 1024 * 1024);
  useEffect(() => { let active = true; http.get('/avatars/limits').then(({ data }) => { if (active) setMaxBytes(data.max_bytes); }).catch(() => {}); return () => { active = false; }; }, []);
  const save = async (action: () => Promise<User>, propagate = false) => {
    setBusy(true); setMessage(''); setProgress(0);
    try { const updated = await action(); onSaved(updated); setError(false); setMessage('Profile media updated.'); setSource(null); }
    catch (err) { setError(true); setMessage(err instanceof Error ? err.message : 'Unable to update profile media.'); if (propagate) throw err; }
    finally { setBusy(false); }
  };
  const change = (updates: Partial<User>) => self ? api.updateCurrentUserProfile(user.id, { ...updates, updatedAt: user.updatedAt }) : api.updateUser(user.id, { ...updates, updatedAt: user.updatedAt }, user.id);
  const crop = async (metadata: AvatarCropMetadata) => {
    if (!source) return;
    await save(() => self ? api.uploadCurrentUserAvatar(source, metadata, setProgress, user.updatedAt) : api.uploadUserAvatar(user.id, source, metadata, setProgress, user.updatedAt), true);
  };
  return <div className="space-y-4" aria-label="Profile media">
    <div className="flex flex-wrap items-center gap-5"><Avatar user={user} size={96} />
      <div className="space-y-2"><div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Upload or replace picture'}</button>
        <button type="button" onClick={() => save(() => change({ avatarAssetId: null }))} disabled={busy || !(user.avatarUrl || user.profileImageUrl || user.avatarAssetId)} className="rounded-lg border border-border-color px-4 py-2 text-text-primary disabled:opacity-50">Remove picture</button>
      </div><p className="text-xs text-text-secondary">JPEG, PNG or WebP · up to {maxBytes / 1024 / 1024} MB. Crop and preview before saving.</p></div>
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile picture" className="sr-only" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; setMessage('');
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxBytes) { setError(true); setMessage(`Choose a JPEG, PNG or WebP image up to ${maxBytes / 1024 / 1024} MB.`); return; }
      const reader = new FileReader(); reader.onload = () => setSource(String(reader.result)); reader.onerror = () => { setError(true); setMessage('Unable to read this image.'); }; reader.readAsDataURL(file);
    }} />
    {busy && <div role="status" className="space-y-1"><progress aria-label="Avatar upload progress" max={100} value={progress} className="w-full" /><p className="text-xs text-text-secondary">{progress < 100 ? `Uploading ${progress}%` : 'Processing image…'}</p></div>}
    <fieldset disabled={busy}><legend className="mb-2 text-sm font-medium text-text-primary">Avatar frame</legend><div className="flex flex-wrap gap-2">{FRAME_OPTIONS.map(({ id, label }) => <button type="button" key={id} aria-pressed={(user.avatarFrame || 'classic') === id} onClick={() => save(() => change({ avatarFrame: id }))}
      className={`rounded-lg border px-3 py-2 text-sm text-text-primary ${(user.avatarFrame || 'classic') === id ? 'border-cyan-400 bg-cyan-500/15' : 'border-border-color'}`}>{label}</button>)}</div></fieldset>
    {message && <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-400' : 'text-emerald-500'}`}>{message}</p>}
    {source && <AvatarCropModal isOpen imageSrc={source} onCancel={() => { if (!busy) setSource(null); }} onCompleteWithMetadata={crop} />}
  </div>;
}
