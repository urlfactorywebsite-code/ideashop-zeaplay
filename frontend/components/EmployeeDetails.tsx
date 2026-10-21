import React, { useEffect, useState } from 'react';
import { User, Project } from '../types';
import api from '../services/mockApi';
import EmployeeIdentityCard from './EmployeeIdentityCard';

const fields = (entries: [string, string | undefined][]) => <dl className="mt-3 grid gap-3 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-400">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm text-slate-200">{value || 'Not provided'}</dd></div>)}</dl>;
export default function EmployeeDetails({ user, managerName }: { user: User; managerName?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setLoading(true); setFailed(false);
    (async () => {
      const matches: Project[] = [];
      for (let page = 1; active; page++) {
        const result = await api.getProjects({ page, pageSize: 100 });
        matches.push(...result.items.filter(project => project.members?.some(member => member.userId === user.id)));
        if (page >= result.totalPages) break;
      }
      if (active) setProjects(matches);
    })().catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id]);
  return <div className="mt-5 space-y-4"><EmployeeIdentityCard user={user} />
    <section className="rounded-xl border border-white/10 p-4"><h3 className="font-medium text-white">Skills and expertise</h3><p className="mt-2 text-sm text-slate-300">{user.skills?.join(' · ') || 'No skills listed.'}</p></section>
    <details className="rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-medium text-white">Additional Details</summary>
      <h4 className="mt-4 text-sm font-semibold text-cyan-200">Personal details</h4>{fields([['Full / display name', user.name], ['Phone', user.phone], ['Location', user.location], ['Timezone', user.timezone], ['Profile bio', user.profileBio]])}
      <h4 className="mt-5 text-sm font-semibold text-cyan-200">Employment details</h4>{fields([['Employee ID', user.employerId], ['Designation', user.title], ['Department', user.department], ['Reports to', managerName], ['Manager email', user.managerEmail], ['Shift', user.shiftName], ['Shift hours', user.shiftStart && user.shiftEnd ? `${user.shiftStart} – ${user.shiftEnd}` : undefined], ['Morning break', [user.morningBreakStart, user.morningBreakEnd].filter(Boolean).join(' – ')], ['Lunch break', [user.lunchBreakStart, user.lunchBreakEnd].filter(Boolean).join(' – ')], ['Evening break', [user.eveningBreakStart, user.eveningBreakEnd].filter(Boolean).join(' – ')]])}
      <h4 className="mt-5 text-sm font-semibold text-cyan-200">Professional details</h4>{fields([['Skills', user.skills?.join(', ')], ['Existing work notes', user.notes]])}
    </details>
    <section className="rounded-xl border border-white/10 p-4"><h3 className="font-medium text-white">Assigned Projects</h3>{loading ? <p role="status" className="mt-2 text-sm text-slate-400">Loading projects…</p> : failed ? <p role="alert" className="mt-2 text-sm text-rose-300">Projects could not be loaded.</p> : projects.length ? <ul className="mt-3 space-y-2">{projects.map(project => <li key={project.id} className="flex flex-wrap justify-between gap-2 text-sm text-slate-200"><span>{project.name}</span><span className="text-slate-400">{project.members.find(member => member.userId === user.id)?.role || 'Member'}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-400">No assigned projects visible to you.</p>}
      {!!user.projects?.length && <p className="mt-3 text-xs text-slate-400">Profile project labels: {user.projects.join(', ')}</p>}
    </section>
    <section className="rounded-xl border border-white/10 p-4"><h3 className="font-medium text-white">Work and activity</h3>{fields([['Tasks created', String(user.tasksCreated ?? 0)], ['Tasks completed', String(user.tasksCompleted ?? 0)], ['Points', String(user.points ?? 0)]])}</section>
  </div>;
}
