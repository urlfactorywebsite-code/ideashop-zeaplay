import React from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { CalendarDays } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { taskDateKey } from '../../utils/taskDates';
import { formatSubtaskDueDate } from '../../utils/subtaskDueDates';
import 'react-day-picker/dist/style.css';
import './DatePicker.css';

interface DatePickerProps {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  timezone?: string;
  className?: string;
  dialogLabel?: string;
  dataField?: string;
}

export default function DatePicker({ id, value, onChange, disabled, allowClear = true, timezone,
  className = 'modal-input', dialogLabel = 'Choose due date', dataField }: DatePickerProps) {
  const todayKey = () => taskDateKey(new Date().toISOString(), timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return <Popover>
    {({ close }) => {
      const today = new Date(`${todayKey()}T12:00:00`);
      return <>
        <PopoverButton id={id} type="button" disabled={disabled} aria-haspopup="dialog" data-subtask-field={dataField}
          aria-describedby={`${id}-value`} className={`${className} task-picker-trigger`}>
          <span id={`${id}-value`}>{value ? formatSubtaskDueDate(value) : 'Select due date'}</span>
          <CalendarDays size={17} aria-hidden="true" />
        </PopoverButton>
        <PopoverPanel anchor={{ to: 'bottom start', gap: 8, padding: 12 }} portal focus transition
          role="dialog" aria-label={dialogLabel} className="task-picker-popover">
          <DayPicker mode="single" required selected={selected} defaultMonth={selected ?? today} today={today} disabled={disabled}
            autoFocus animate showOutsideDays className="task-picker-calendar"
            onSelect={date => { onChange(dateKey(date)); close(); }} />
          <div className="task-picker-actions">
            {allowClear ? <button type="button" disabled={disabled || !value} onClick={() => { onChange(null); close(); }}>Clear date</button> : <span />}
            <button type="button" disabled={disabled} onClick={() => { onChange(todayKey()); close(); }}>Today</button>
          </div>
        </PopoverPanel>
      </>;
    }}
  </Popover>;
}
