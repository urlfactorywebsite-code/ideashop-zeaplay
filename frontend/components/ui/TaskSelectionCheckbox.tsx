import React from 'react';
import { Check, Minus } from 'lucide-react';
import './TaskSelectionCheckbox.css';

export default function TaskSelectionCheckbox({ label, checked, indeterminate = false, onChange }: {
  label: string; checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return <label className="task-selection-control" onClick={event => event.stopPropagation()}>
    <input className="task-selection-checkbox" type="checkbox" aria-label={label}
      checked={checked} aria-checked={indeterminate ? 'mixed' : checked}
      ref={input => { if (input) input.indeterminate = indeterminate; }} onChange={onChange} />
    <Check className="task-selection-check" size={14} strokeWidth={3} aria-hidden="true" />
    <Minus className="task-selection-mixed" size={14} strokeWidth={3} aria-hidden="true" />
  </label>;
}
