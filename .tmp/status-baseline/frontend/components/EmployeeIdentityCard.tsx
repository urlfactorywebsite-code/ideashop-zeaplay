import React from 'react';
import { User } from '../types';
import Avatar from './Avatar';

export default function EmployeeIdentityCard({ user }: { user: User }) {
  return <article aria-label="Employee digital ID" className="rounded-2xl border border-cyan-400/30 bg-slate-950 p-5 text-slate-100 shadow-lg transition-colors hover:border-cyan-300/60 sm:p-6">
    <p className="mb-5 text-xs font-semibold tracking-[.2em] text-cyan-300">ZEA.PLAY · EMPLOYEE ID</p>
    <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start"><Avatar user={user} size={104} />
      <div className="min-w-0 flex-1"><h2 className="break-words text-2xl font-semibold">{user.name || 'Name not provided'}</h2><p className="mt-1 break-words text-slate-300">{user.title || 'Designation not set'}</p>
        <div className="mt-3 flex flex-wrap gap-2">{[user.role?.toUpperCase() || 'Role not set', user.department || 'Department not set', user.status?.toUpperCase() || 'Status not set'].map((label, index) => <span key={index} className="max-w-full break-words rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1 text-xs font-medium text-cyan-100">{label}</span>)}</div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">Employee ID</dt><dd className="break-words">{user.employerId || 'Not assigned'}</dd></div><div><dt className="text-xs text-slate-400">Email</dt><dd className="break-all">{user.email || 'Not provided'}</dd></div></dl>
      </div>
    </div>
    <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{user.profileBio || 'No professional bio added yet.'}</p>
    <div className="mt-4 flex flex-wrap gap-2">{(user.skills || []).map((skill, index) => <span key={`${skill}-${index}`} className="max-w-full break-words rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{skill}</span>)}</div>
  </article>;
}
