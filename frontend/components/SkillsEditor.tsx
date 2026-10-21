import React, { useId, useState } from 'react';

export const normalizeSkills = (skills: string[]) => Array.from(new Map(skills.map(skill => [skill.trim().toLocaleLowerCase(), skill.trim()])).values()).filter(Boolean);
export default function SkillsEditor({ value, onChange, suggestions = [], disabled = false }: {
  value: string[]; onChange: (skills: string[]) => void; suggestions?: string[]; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const label = draft.trim().replace(/\s+/g, ' ');
    if (!label) return;
    if (value.some(skill => skill.toLocaleLowerCase() === label.toLocaleLowerCase())) { setError('That skill is already listed.'); return; }
    if (value.length >= 30 || label.length > 60) { setError('Use up to 30 skills, each at most 60 characters.'); return; }
    onChange([...value, label]); setDraft(''); setError('');
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{value.map(skill => <span key={skill} className="inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-sm text-text-primary">
      <span className="break-words">{skill}</span><button type="button" disabled={disabled} aria-label={`Remove ${skill}`} onClick={() => onChange(value.filter(item => item !== skill))}>×</button>
    </span>)}</div>
    <div className="flex gap-2"><input aria-label="Search or add a skill" list={id} value={draft} maxLength={60} disabled={disabled}
      onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
      placeholder="Search or add a skill" className="min-w-0 flex-1 rounded-lg border border-border-color bg-background px-3 py-2 text-text-primary" />
      <button type="button" disabled={disabled} onClick={add} className="rounded-lg border border-cyan-400/40 px-4 py-2 text-text-primary">Add skill</button></div>
    <datalist id={id}>{normalizeSkills(suggestions).filter(skill => !value.some(item => item.toLowerCase() === skill.toLowerCase())).map(skill => <option key={skill} value={skill} />)}</datalist>
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
  </div>;
}
