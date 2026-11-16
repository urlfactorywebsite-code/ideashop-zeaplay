import React from 'react';
import { useAuth } from '../hooks/useAuth';
import DatePicker from './ui/DatePicker';

export default function SubtaskDueDateField({ enabled, value, onChange, disabled, inputClassName = 'modal-input', labelClassName = 'text-sm' }: {
  enabled: boolean; value: string | null; onChange: (enabled: boolean, value: string | null) => void;
  disabled?: boolean; inputClassName?: string; labelClassName?: string;
}) {
  const id = React.useId();
  const { user } = useAuth();
  return <div className="space-y-2">
    <label className={`flex items-center gap-2 ${labelClassName}`}>
      <input type="checkbox" checked={enabled} disabled={disabled}
        onChange={event => onChange(event.target.checked, null)}
        className="h-4 w-4 rounded border-white/20 bg-black/30 text-cyan-400 focus:ring-cyan-400" />
      Set due date
    </label>
    {enabled && <div>
      <label htmlFor={id} className={`block mb-1 ${labelClassName}`}>Subtask due date</label>
      <DatePicker id={id} value={value} onChange={date => onChange(true, date)} disabled={disabled}
        timezone={user?.timezone} className={inputClassName} dialogLabel="Choose subtask due date" dataField="due_date" />
    </div>}
  </div>;
}
