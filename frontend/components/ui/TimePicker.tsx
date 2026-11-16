import React, { useId, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Clock3 } from 'lucide-react';
import './DatePicker.css';

function TimeOptions({ value, onChange, close, disabled }: { value: string; onChange: (value: string) => void; close: () => void; disabled?: boolean }) {
  const id = useId();
  const [hour, setHour] = useState(value.split(':')[0] || '00');
  const [minute, setMinute] = useState(value.split(':')[1] || '00');
  const validPart = (part: string, max: number) => /^\d{1,2}$/.test(part) && Number(part) <= max;
  const validHour = validPart(hour, 23), validMinute = validPart(minute, 59);
  const apply = () => {
    if (disabled || !validHour || !validMinute) return;
    onChange(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
    close();
  };
  return <div onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply(); }
  }}>
    <p className="task-time-title">Set due time</p>
    <p className="task-time-hint" id={`${id}-hint`}>24-hour time</p>
    <div className="task-time-inputs">
      <label htmlFor={`${id}-hours`}>Hours
        <input id={`${id}-hours`} type="number" inputMode="numeric" min="0" max="23" step="1" required
          value={hour} disabled={disabled} onChange={event => setHour(event.target.value)} aria-invalid={!validHour} aria-describedby={`${id}-hint`} />
      </label>
      <span aria-hidden="true">:</span>
      <label htmlFor={`${id}-minutes`}>Minutes
        <input id={`${id}-minutes`} type="number" inputMode="numeric" min="0" max="59" step="1" required
          value={minute} disabled={disabled} onChange={event => setMinute(event.target.value)} aria-invalid={!validMinute} aria-describedby={`${id}-hint`} />
      </label>
    </div>
    {(!validHour || !validMinute) && <p role="alert" className="task-time-error">Use hours 0–23 and minutes 0–59.</p>}
    <div className="task-picker-actions task-time-footer">
      <button type="button" onClick={close}>Cancel</button>
      <button type="button" className="task-time-apply" disabled={disabled || !validHour || !validMinute} onClick={apply}>Apply time</button>
    </div>
  </div>;
}

export default function TimePicker({ id, value, onChange, disabled, className = 'modal-input' }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean; className?: string;
}) {
  const display = value ? new Date(`2000-01-01T${value}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Select time';
  return <Popover>
    {({ close }) => <>
      <PopoverButton id={id} type="button" disabled={disabled} aria-haspopup="dialog" aria-describedby={`${id}-value`}
        className={`${className} task-picker-trigger`}>
        <span id={`${id}-value`}>{display}</span><Clock3 size={17} aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel anchor={{ to: 'bottom start', gap: 8, padding: 12 }} portal focus transition
        role="dialog" aria-label="Choose due time" className="task-picker-popover">
        <TimeOptions value={value} onChange={onChange} close={close} disabled={disabled} />
      </PopoverPanel>
    </>}
  </Popover>;
}
