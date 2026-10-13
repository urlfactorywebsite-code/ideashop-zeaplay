import React, { useEffect, useState } from 'react';
import { XIcon, DownloadIcon } from 'lucide-react';
import { MediaCategory, MediaItem } from '../../types';

type MediaDetailsDrawerProps = {
  item: MediaItem | null;
  open: boolean;
  onClose: () => void;
  onDelete: (mediaId: string) => Promise<void>;
  onCopyUrl: (url: string) => void;
  canDelete: boolean;
};

const formatBytes = (size: number): string => {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const MediaDetailsDrawer: React.FC<MediaDetailsDrawerProps> = ({
  item,
  open,
  onClose,
  onDelete,
  onCopyUrl,
  canDelete,
}) => {
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDeleting(false);
  }, [item]);

  if (!item || !open) {
    return null;
  }

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(item.id);
    setDeleting(false);
    onClose();
  };

  const renderPreview = () => {
    switch (item.category) {
      case MediaCategory.IMAGE:
        return <img src={item.readUrl} alt={item.filename} className="h-64 w-full rounded-2xl object-cover" />;
      case MediaCategory.VIDEO:
        return (
          <video controls className="h-64 w-full rounded-2xl bg-black" src={item.readUrl}>
            Your browser does not support video playback.
          </video>
        );
      default:
        return (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-300">
            Preview not available. Use the button below to download.
          </div>
        );
    }
  };

  const extension = item.ext || item.filename.split('.').pop()?.toLowerCase() || 'file';

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[#05050A] p-6 shadow-2xl shadow-black/70">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{item.filename}</h2>
            <p className="text-sm text-slate-400">{item.contentType}</p>
          </div>
          <button className="rounded-full bg-slate-800 p-2 text-slate-400 hover:text-white" onClick={onClose}>
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5">
          {renderPreview()}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Metadata</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm text-slate-300">
              <div>
                <dt className="text-slate-500">Size</dt>
                <dd>{formatBytes(item.sizeBytes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Type</dt>
                <dd>{extension}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Created</dt>
                <dd>{formatDate(item.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Content Type</dt>
                <dd className="truncate">{item.contentType}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onCopyUrl(item.readUrl)}
                className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-indigo-400 hover:text-indigo-200"
              >
                Copy URL
              </button>
              <a
                href={item.readUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full border border-transparent bg-indigo-600/80 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow shadow-indigo-900/40"
              >
                <DownloadIcon className="h-4 w-4" />
                Download
              </a>
            </div>
          </div>

          {canDelete && (
            <div className="rounded-2xl border border-red-900/60 bg-red-950/40 p-4">
              <p className="text-xs uppercase tracking-wide text-red-200">Delete</p>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="mt-3 w-full rounded-full border border-red-700 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                {deleting ? 'Deleting.' : 'Delete media'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaDetailsDrawer;
