import React from 'react';
import clsx from 'clsx';
import { MediaSortOption } from '../../types';

const sortOptions: { label: string; value: MediaSortOption }[] = [
  { label: 'Newest', value: 'created_desc' },
  { label: 'Oldest', value: 'created_asc' },
  { label: 'Size • High → Low', value: 'size_desc' },
  { label: 'Size • Low → High', value: 'size_asc' },
];

type MediaToolbarProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  sort: MediaSortOption;
  onSortChange: (value: MediaSortOption) => void;
  dateFrom?: string;
  dateTo?: string;
  onDateRangeChange: (range: { from?: string; to?: string }) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onResetFilters?: () => void;
};

const MediaToolbar: React.FC<MediaToolbarProps> = ({
  searchValue,
  onSearchChange,
  sort,
  onSortChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  onResetFilters,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="w-full space-y-4 rounded-2xl bg-slate-900/70 p-4 shadow-lg shadow-slate-900/40 ring-1 ring-slate-800 backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900 px-3 py-2">
          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search filename..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
        </div>
        <select
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as MediaSortOption)}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value} className="bg-slate-900">
              {option.label}
            </option>
          ))}
        </select>
        {onResetFilters && (
          <button
            onClick={onResetFilters}
            className="rounded-xl border border-transparent bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:text-white"
          >
            Reset
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
          From
          <input
            type="date"
            value={dateFrom ?? ''}
            onChange={(event) => onDateRangeChange({ from: event.target.value || undefined, to: dateTo })}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
          To
          <input
            type="date"
            value={dateTo ?? ''}
            onChange={(event) => onDateRangeChange({ from: dateFrom, to: event.target.value || undefined })}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
          Page size
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {[12, 24, 48, 96].map((size) => (
              <option key={size} value={size} className="bg-slate-900">
                {size} items
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-400">
          Showing{' '}
          <span className="font-semibold text-white">
            {start}-{end}
          </span>{' '}
          of <span className="font-semibold text-white">{total}</span> items
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={clsx(
              'rounded-full border px-4 py-2 text-sm transition',
              page <= 1
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-slate-700 text-white hover:border-indigo-500 hover:text-indigo-300'
            )}
          >
            Prev
          </button>
          <span className="text-sm text-slate-400">
            Page <span className="font-semibold text-white">{page}</span> / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={clsx(
              'rounded-full border px-4 py-2 text-sm transition',
              page >= totalPages
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-slate-700 text-white hover:border-indigo-500 hover:text-indigo-300'
            )}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaToolbar;
