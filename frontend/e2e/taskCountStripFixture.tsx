// Isolated presentation fixture; not imported by the application entry.
import React, { Profiler, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TaskCountStrip, { type TaskCountItem } from '../components/TaskCountStrip';

type Snapshot = { total: number; statuses: TaskCountItem[] };
const audit = { commits: 0, parentRenders: 0, set: (_data: Snapshot | null) => {}, rerender: () => {}, unmount: () => {} };
Object.assign(window, { countStripFixture: audit });
function Fixture() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [mounted, setMounted] = useState(true);
  const [, redraw] = useState(0);
  audit.parentRenders++;
  useEffect(() => {
    audit.set = setData; audit.rerender = () => redraw(n => n + 1); audit.unmount = () => setMounted(false);
  }, []);
  return mounted ? <Profiler id="counts" onRender={() => audit.commits++}>
    <TaskCountStrip ready={data !== null} total={data?.total ?? 0} statuses={data?.statuses || Array.from({ length: 11 }, (_, i) => ({ id: String(i), label: `Status ${i}`, count: 0 }))} />
  </Profiler> : null;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
