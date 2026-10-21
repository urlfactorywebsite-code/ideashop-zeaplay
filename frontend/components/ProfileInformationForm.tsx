import React, { useEffect, useState } from 'react';
import { Department, Role, User } from '../types';
import api from '../services/mockApi';
import SkillsEditor from './SkillsEditor';

export default function ProfileInformationForm({ user, departments, onSaved }: { user: User; departments: Department[]; onSaved: (user: User) => void }) {
  const initial = () => ({ name: user.name, profileBio: user.profileBio || '', phone: user.phone || '', location: user.location || '', timezone: user.timezone || '', skills: user.skills || [], employerId: user.employerId || '', department: user.department || '' });
  const [form, setForm] = useState(initial);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => { setForm(initial()); }, [user.id]);
  useEffect(() => { let active = true; api.getUsers().then(users => { if (active) setSuggestions(users.flatMap(item => item.skills || [])); }).catch(() => {}); return () => { active = false; }; }, [user.tenantId]);
  const admin = user.role === Role.ADMIN || user.role === Role.OWNER;
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const { employerId, department, ...personal } = form;
      const updated = await api.updateCurrentUserProfile(user.id, { ...personal, name: form.name.trim(), ...(admin ? { employerId, department } : {}), updatedAt: user.updatedAt });
      onSaved(updated); setForm(previous => ({ ...previous, skills: updated.skills || [] })); setError(false); setMessage('Profile saved.');
    } catch (err) { setError(true); setMessage(err instanceof Error ? err.message : 'Unable to save profile.'); }
    finally { setBusy(false); }
  }}>
    <label className="block text-sm text-text-secondary">Full / display name<input required maxLength={255} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" /></label>
    <p className="break-all text-sm text-text-secondary">{user.email}</p>
    <label className="block text-sm text-text-secondary">Professional bio<textarea maxLength={500} rows={4} value={form.profileBio} onChange={event => setForm({ ...form, profileBio: event.target.value })} className="mt-1 w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" /><span className="text-xs">{form.profileBio.length}/500 characters</span></label>
    <fieldset><legend className="mb-2 text-sm text-text-secondary">Skills and expertise</legend><SkillsEditor value={form.skills} suggestions={suggestions} onChange={skills => setForm({ ...form, skills })} disabled={busy} /></fieldset>
    <details className="rounded-lg border border-border-color p-3"><summary className="cursor-pointer text-sm font-medium text-text-primary">Additional details</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['phone', 'location', 'timezone'] as const).map(key => <label key={key} className="text-sm capitalize text-text-secondary">{key}<input value={form[key]} maxLength={key === 'phone' ? 50 : key === 'timezone' ? 64 : 255} placeholder={key === 'timezone' ? 'Asia/Kolkata' : ''} onChange={event => setForm({ ...form, [key]: event.target.value })} className="mt-1 w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" /></label>)}
      <label className="text-sm text-text-secondary">Employee ID<input disabled={!admin} value={form.employerId} onChange={event => setForm({ ...form, employerId: event.target.value })} className="mt-1 w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary disabled:opacity-60" /></label>
      <label className="text-sm text-text-secondary">Department<select aria-label="Department" disabled={!admin} value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} className="mt-1 w-full rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary disabled:opacity-60"><option value="">Unassigned</option>{departments.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
      </div>
    </details>
    {message && <p role={error ? 'alert' : 'status'} className={error ? 'text-sm text-rose-400' : 'text-sm text-emerald-500'}>{message}</p>}
    <button type="submit" disabled={busy} className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button>
  </form>;
}
