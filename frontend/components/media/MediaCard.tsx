import React from 'react';
import { ImageIcon, VideoIcon, FileTextIcon, ArchiveIcon, CopyIcon, Trash2Icon } from 'lucide-react';
import { MediaItem, MediaCategory } from '../../types';

type MediaCardProps = {
  item: MediaItem;
  isSelected: boolean;
  onSelect: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onCopyUrl: (item: MediaItem) => void;
  canDelete: boolean;
};

const formatBytes = (size: number): string => {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const getCategoryIcon = (category: MediaCategory) => {
  switch (category) {
    case MediaCategory.IMAGE:
      return <ImageIcon className="h-5 w-5 text-pink-300" />;
    case MediaCategory.VIDEO:
      return <VideoIcon className="h-5 w-5 text-purple-300" />;
    case MediaCategory.ZIP:
      return <ArchiveIcon className="h-5 w-5 text-amber-300" />;
    case MediaCategory.DOCUMENT:
      return <FileTextIcon className="h-5 w-5 text-cyan-300" />;
    default:
      return <FileTextIcon className="h-5 w-5 text-cyan-300" />;
  }
};

const MediaCard: React.FC<MediaCardProps> = ({ item, isSelected, onSelect, onDelete, onCopyUrl, canDelete }) => {
  const isImage = item.category === MediaCategory.IMAGE;
  const extension = item.ext || item.filename.split('.').pop()?.toLowerCase() || 'file';
  const createdLabel = new Date(item.createdAt).toLocaleDateString();

  return (
    <div
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/80 shadow-lg shadow-black/30 transition hover:-translate-y-1 hover:border-indigo-400/60 ${
        isSelected ? 'ring-2 ring-indigo-500' : ''
      }`}
      onClick={() => onSelect(item)}
    >
      <div className="relative h-40 w-full overflow-hidden bg-slate-800">
        {isImage ? (
          <img src={item.readUrl} alt={item.filename} className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            {getCategoryIcon(item.category)}
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          .{extension}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="truncate text-sm font-semibold text-white">{item.filename}</p>
        <div className="text-xs text-slate-400">
          <p>{formatBytes(item.sizeBytes)}</p>
          <p>{createdLabel}</p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-slate-500">
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-indigo-400 hover:text-indigo-200"
            onClick={(event) => {
              event.stopPropagation();
              onCopyUrl(item);
            }}
          >
            <CopyIcon className="h-4 w-4" />
            Copy URL
          </button>
          {canDelete && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-red-300 transition hover:border-red-500 hover:text-red-200"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(item);
              }}
            >
              <Trash2Icon className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaCard;
