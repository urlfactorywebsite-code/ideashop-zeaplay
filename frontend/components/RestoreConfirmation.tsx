import React from 'react';
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { ArrowPathIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import './RestoreConfirmation.css';

type Props = {
  kind: 'Project' | 'Client'; name: string; busy: boolean; error: string | null;
  onClose: () => void; onConfirm: () => void;
};

export default function RestoreConfirmation({ kind, name, busy, error, onClose, onConfirm }: Props) {
  return <Dialog open onClose={() => { if (!busy) onClose(); }} className="restore-dialog">
    <DialogBackdrop className="restore-backdrop" />
    <div className="restore-container"><DialogPanel className="restore-panel" aria-busy={busy}>
      <DialogTitle className="restore-title">Restore {kind}?</DialogTitle>
      <Description as="div">
      <p className="restore-name">{name}</p>
      <p className="restore-description">{kind === 'Project'
        ? 'Are you sure you want to restore this project? The project will become active again, and its existing tasks, subtasks, team members, and historical records will be preserved.'
        : 'Are you sure you want to restore this client? Its company information, linked contacts, projects, and historical records will be preserved.'}</p>
      </Description>
      {error && <p role="alert" className="restore-error">{error}</p>}
      <div className="restore-actions">
        <button type="button" data-autofocus disabled={busy} onClick={onClose} className="restore-cancel">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="restore-confirm">
          {busy ? <ArrowPathIcon className="restore-spinner" aria-hidden="true" /> : <ArrowUturnLeftIcon aria-hidden="true" />}
          {busy ? 'Restoring…' : `Restore ${kind}`}
        </button>
      </div>
    </DialogPanel></div>
  </Dialog>;
}
