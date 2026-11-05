import React, { useState } from 'react';
import { http } from '../services/mockApi';
import { taskInstant } from '../utils/taskDates';

type Hold = { id:string; started_at:string; ended_at:string|null; reason:string|null; previous_status:string;
  original_due_at:string|null; started_by_id:string|null; ended_by_id:string|null; source:string };

export default function TaskHoldHistory({taskId, timezone}:{taskId:string;timezone:string}) {
  const [rows,setRows]=useState<Hold[]|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{setRows((await http.get<Hold[]>(`/tasks/${taskId}/holds`)).data);}catch{setError('Unable to load hold history.');}finally{setLoading(false);}};
  const when=(value:string|null)=>value?taskInstant(value).setZone(timezone).toLocaleString({dateStyle:'medium',timeStyle:'long'}):'Still on hold';
  return <details className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm" onToggle={event=>{if(event.currentTarget.open&&rows===null&&!loading)void load();}}>
    <summary className="cursor-pointer rounded font-semibold focus-visible:ring-2 focus-visible:ring-cyan-300">Audited hold history</summary>
    {loading&&<p role="status" className="mt-3">Loading hold history...</p>}
    {error&&<p role="alert" className="mt-3">{error} <button className="underline" onClick={()=>void load()}>Retry</button></p>}
    {rows?.length===0&&<p className="mt-3 text-white/60">No recorded hold periods.</p>}
    <ol className="mt-3 space-y-3">{rows?.map(row=><li key={row.id} className="space-y-1 rounded-lg border border-white/10 p-3 [overflow-wrap:anywhere]">
      <p>{when(row.started_at)} — {when(row.ended_at)}</p>
      <p className="text-white/70">{row.reason||'No reason supplied'} · Previous state: {row.previous_status}</p>
      <p className="text-xs text-white/50">Started by {row.started_by_id||'system/migration'}; ended by {row.ended_by_id||'not yet ended'}. Source: {row.source}.</p>
    </li>)}</ol>
  </details>;
}
