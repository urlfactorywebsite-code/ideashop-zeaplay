import React from 'react';
import MediaCard from './MediaCard';
import { MediaItem } from '../../types';

type MediaGridProps = {
  items: MediaItem[];
  loading: boolean;
  selectedId?: string;
  onSelect: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onCopyUrl: (item: MediaItem) => void;
  canDelete: boolean;
};

const MediaGrid: React.FC<MediaGridProps> = ({ items, loading, selectedId, onSelect, onDelete, onCopyUrl, canDelete }) => {
  if (!loading && items.length === 0) {
    return (
      <div className="mt-10 rounded-3xl border border-dashed border-slate-800/80 bg-slate-900/60 p-10 text-center text-slate-400">
        <p className="text-lg font-semibold text-white">No media yet</p>
        <p className="text-sm text-slate-400">Upload files to populate this tab.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {loading
        ? Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="h-64 animate-pulse rounded-3xl border border-slate-800/70 bg-slate-900/60"
            />
          ))
        : items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              isSelected={item.id === selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
              onCopyUrl={onCopyUrl}
              canDelete={canDelete}
            />
          ))}
    </div>
  );
};

export default MediaGrid;
