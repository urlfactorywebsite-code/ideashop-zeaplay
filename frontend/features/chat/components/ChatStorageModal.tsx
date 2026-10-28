import React, { useEffect, useRef, useState } from 'react';
import { HardDrive, Loader2, Trash2, X } from 'lucide-react';
import { chatService } from '../services/chatService';
import { ChatStorage, ChatStorageFile, formatStorageMB } from '../utils/storage';

const ChatStorageModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onStorage: (storage: ChatStorage) => void;
  onRemoved: (uploadId: string) => void;
}> = ({ open, onClose, onStorage, onRemoved }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [storage, setStorage] = useState<ChatStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ChatStorageFile | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    let active = true;
    setBusy(true);
    setStorage(null);
    setConfirm(null);
    setError(null);
    void chatService.getStorage().then(data => {
      if (active) { setStorage(data); onStorage(data); }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load storage'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; dialog.current?.close(); };
  }, [open, version]);

  const remove = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await chatService.deleteStorageFile(confirm.id);
      onRemoved(confirm.id);
      setVersion(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : 'Cleanup failed'); setBusy(false); }
  };
  const loadMore = async () => {
    if (!storage || busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await chatService.getStorage(storage.items.length);
      setStorage({ ...page, items: [...storage.items, ...page.items] });
      onStorage(page);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load files'); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return (
    <dialog ref={dialog} aria-labelledby="chat-storage-title" onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto w-[min(94vw,36rem)] rounded-2xl border border-slate-700 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-black/70 dark:bg-slate-900 dark:text-slate-100">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="chat-storage-title" className="flex items-center gap-2 font-bold"><HardDrive className="h-5 w-5" /> Chat storage</h2>
        <button type="button" aria-label="Close storage" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-500/20"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Each user has 200 MB for chat images and files. Uploaded drafts also count. Choose files to delete to free space.</p>
      {storage && <div className="mb-3 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
        <p className="mb-2 text-sm font-semibold">{formatStorageMB(storage.used_bytes)} / {formatStorageMB(storage.limit_bytes)} used</p>
        <div role="progressbar" aria-label="Chat storage used" aria-valuenow={storage.used_bytes} aria-valuemin={0} aria-valuemax={Math.max(storage.limit_bytes, storage.used_bytes)} className="h-2 overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700">
          <div className={`h-full ${storage.remaining_bytes === 0 ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, storage.used_bytes / storage.limit_bytes * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatStorageMB(storage.remaining_bytes)} available · {storage.file_count} files · largest first</p>
      </div>}
      {error && <p role="alert" className="mb-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      {confirm ? <div className="rounded-xl border border-rose-500/30 p-4">
        <p className="text-sm font-semibold">Delete {confirm.original_file_name}?</p>
        <p className="my-2 text-xs text-slate-500 dark:text-slate-400">This permanently removes this file from shared messages for everyone. Message text is kept.</p>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">Delete permanently</button>
          <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="rounded-lg border border-slate-500/30 px-3 py-2 text-xs">Cancel</button></div>
      </div> : <div className="max-h-[45vh] space-y-2 overflow-y-auto">
        {storage?.items.map(file => <div key={file.id} className="flex items-center gap-3 rounded-xl border border-slate-500/20 p-3">
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{file.original_file_name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatStorageMB(file.file_size)} · {file.attached ? 'Shared file' : 'Unsent upload'}</p></div>
          <button type="button" disabled={busy} onClick={() => setConfirm(file)} aria-label={`Delete ${file.original_file_name}`} className="rounded-lg p-2 text-rose-500 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
        </div>)}
        {storage?.items.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No uploaded files. All 200 MB is available.</p>}
        {storage?.has_more && <button type="button" disabled={busy} onClick={() => void loadMore()} className="rounded-lg border border-slate-500/30 px-3 py-2 text-xs">Load more files</button>}
      </div>}
      {busy && <p role="status" className="mt-3 flex items-center gap-2 text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Updating storage…</p>}
    </dialog>
  );
};

export default ChatStorageModal;
