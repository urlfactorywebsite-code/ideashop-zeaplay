import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { COUNT_ROLL_SECONDS, countStagger, planCountReel, validTaskCount } from '../utils/taskCountAnimation';
import './TaskCountStrip.css';

const REEL_ROWS = Array.from({ length: 30 }, (_, index) => index % 10);
const reducedQuery = '(prefers-reduced-motion: reduce)';
const readReducedMotion = () => window.matchMedia(reducedQuery).matches;
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

const CountDigit = React.memo(function CountDigit({ digit, value, delay, leading, reduced }: {
  digit: number; value: number | null; delay: number; leading: boolean; reduced: boolean;
}) {
  const position = useMotionValue(10);
  const y = useTransform(position, row => `${-row}em`);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (value === null) {
      previous.current = null;
      position.set(10);
      return;
    }
    const before = previous.current;
    previous.current = value;
    if (reduced || before === null && value === 0) { position.set(10 + digit); return; }
    const { start, target } = planCountReel(position.get(), digit, value < (before ?? 0) ? -1 : 1, before === null);
    position.set(start);
    if (start === target) return;
    const controls = animate(position, target, { duration: COUNT_ROLL_SECONDS, delay: before === null ? delay : 0, ease: [.16, 1, .3, 1] });
    return () => controls.stop();
  }, [digit, value, reduced, delay, position]);
  return <motion.span className="task-count-digit" initial={false} animate={{ opacity: leading ? 0 : 1 }}
    transition={{ duration: reduced ? 0 : .16, delay: reduced || !leading ? 0 : .72 }}>
    <motion.span className="task-count-reel" style={{ y }}>
      {REEL_ROWS.map((number, row) => <span className="task-count-reel-row" key={row}>{number}</span>)}
    </motion.span>
  </motion.span>;
});

const RollingTaskCount = React.memo(function RollingTaskCount({ value, index, reduced }: { value: number | null; index: number; reduced: boolean }) {
  const [rolling, setRolling] = useState(false);
  const [slots, setSlots] = useState(1);
  const previous = useRef<number | null>(null);
  const deadline = useRef(0);
  const length = String(value ?? 0).length;
  const delay = countStagger(index);
  useLayoutEffect(() => {
    if (value === null) {
      previous.current = null;
      deadline.current = 0;
      setRolling(false); setSlots(1);
      return;
    }
    const before = previous.current;
    previous.current = value;
    if (reduced || before === null && value === 0) {
      deadline.current = 0;
      setRolling(false); setSlots(length); return;
    }
    if (before !== value) deadline.current = performance.now() + (COUNT_ROLL_SECONDS + delay) * 1000 + 30;
    const remaining = deadline.current - performance.now();
    if (remaining <= 0) return;
    setSlots(old => Math.max(old, length));
    setRolling(true);
    const timer = window.setTimeout(() => { deadline.current = 0; setRolling(false); setSlots(length); }, remaining);
    return () => window.clearTimeout(timer);
  }, [value, reduced, length, delay]);
  const digits = String(value ?? 0).padStart(Math.max(slots, length), '0').split('');
  const fontSize = Math.floor(28 * Math.min(1, 4 / digits.length));
  return <div className="task-count-number" aria-hidden="true" data-rolling={rolling && !reduced}
    style={{ '--count-number-size': `${fontSize}px` } as React.CSSProperties}>
    <span className="task-count-rest" style={{ visibility: rolling && !reduced ? 'hidden' : 'visible' }}>{value ?? '—'}</span>
    <span className="task-count-reels" style={{ visibility: rolling && !reduced ? 'visible' : 'hidden' }}>
      {digits.map((digit, at) => <CountDigit key={digits.length - at - 1} digit={Number(digit)} value={value} delay={delay}
        leading={at < digits.length - length} reduced={reduced} />)}
    </span>
  </div>;
});

export interface TaskCountItem { id: string; label: string; count: number }

const CalendarTaskCount = React.memo(function CalendarTaskCount({ id, label, count, ready, index, reduced }: TaskCountItem & { ready: boolean; index: number; reduced: boolean }) {
  const value = ready && validTaskCount(count) ? count : null;
  return <div className="task-count-calendar" role="group" aria-label={`${label}: ${value ?? 'Loading count'}`}
    data-count-id={id} data-count-value={value ?? ''}>
    <span className="task-count-bindings" aria-hidden="true"><i /><i /></span>
    <span className="task-count-label" title={label} aria-hidden="true">{label}</span>
    <RollingTaskCount value={value} index={index} reduced={reduced} />
  </div>;
});

interface TaskCountStripProps { total: number; statuses: TaskCountItem[]; ready: boolean }

function TaskCountStrip({ total, statuses, ready }: TaskCountStripProps) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true);
  return <section className="task-count-strip" aria-label="Task counts" aria-busy={!ready} tabIndex={0}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const strip = event.currentTarget;
      if (event.key === 'Home' || event.key === 'End') strip.scrollTo({ left: event.key === 'Home' ? 0 : strip.scrollWidth, behavior: reduced ? 'instant' : 'smooth' });
      else strip.scrollBy({ left: (event.key === 'ArrowRight' ? 1 : -1) * Math.max(106, strip.clientWidth * .6), behavior: reduced ? 'instant' : 'smooth' });
    }}>
    <div className="task-count-row" style={{ '--task-count-columns': statuses.length + 1 } as React.CSSProperties}>
      <CalendarTaskCount id="total" label="Total tasks" count={total} ready={ready} index={0} reduced={reduced} />
      {statuses.map((item, index) => <CalendarTaskCount key={item.id} {...item} ready={ready} index={index + 1} reduced={reduced} />)}
    </div>
  </section>;
}

// The page and refetches can create fresh arrays without changing any counter.
// Compare the small count catalog so unrelated page updates do no strip work.
export default React.memo(TaskCountStrip, (before, after) => before.total === after.total && before.ready === after.ready
  && before.statuses.length === after.statuses.length && before.statuses.every((item, index) => {
    const next = after.statuses[index];
    return item.id === next.id && item.label === next.label && item.count === next.count;
  }));
