import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  MediaCategory,
  MediaItem,
  MediaSortOption,
  MediaUploadTask,
  Role,
} from '../types';
import MediaToolbar from '../components/media/MediaToolbar';
import MediaDropzone from '../components/media/MediaDropzone';
import MediaGrid from '../components/media/MediaGrid';
import MediaDetailsDrawer from '../components/media/MediaDetailsDrawer';
import PageLoader from '../components/loading/PageLoader';

const CATEGORY_TABS: { key: MediaCategory; label: string; accent: string }[] = [
  { key: MediaCategory.IMAGE, label: 'Images', accent: 'from-fuchsia-500 via-pink-500 to-rose-500' },
  { key: MediaCategory.VIDEO, label: 'Videos', accent: 'from-indigo-500 via-purple-500 to-blue-500' },
  { key: MediaCategory.DOCUMENT, label: 'Documents', accent: 'from-amber-500 via-orange-500 to-red-500' },
  { key: MediaCategory.ZIP, label: 'Zip', accent: 'from-slate-500 via-slate-600 to-slate-700' },
];

const CATEGORY_EXTENSIONS: Record<MediaCategory, string[]> = {
  [MediaCategory.IMAGE]: ['jpg', 'jpeg', 'png', 'svg', 'gif', 'webp', 'avif'],
  [MediaCategory.VIDEO]: ['mp4', 'webm', 'mov'],
  [MediaCategory.DOCUMENT]: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'],
  [MediaCategory.ZIP]: ['zip'],
};

const CATEGORY_MIME_TYPES: Record<MediaCategory, string[]> = {
  [MediaCategory.IMAGE]: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/avif',
  ],
  [MediaCategory.VIDEO]: ['video/mp4', 'video/webm', 'video/quicktime'],
  [MediaCategory.DOCUMENT]: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
  [MediaCategory.ZIP]: ['application/zip', 'application/x-zip-compressed'],
};

const MAX_UPLOAD_BYTES: Record<MediaCategory, number> = {
  [MediaCategory.IMAGE]: 5 * 1024 * 1024,
  [MediaCategory.VIDEO]: 200 * 1024 * 1024,
  [MediaCategory.DOCUMENT]: 20 * 1024 * 1024,
  [MediaCategory.ZIP]: 50 * 1024 * 1024,
};

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  zip: 'application/zip',
};

const formatBytes = (size: number): string => {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const getFileExtension = (filename: string): string | null => {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  return parts.pop()?.toLowerCase() ?? null;
};

const resolveContentType = (file: File, allowedTypes: string[]): string => {
  const ext = getFileExtension(file.name);
  const mappedType = ext ? EXTENSION_MIME_TYPES[ext] : undefined;
  const normalizedType = file.type?.split(';')[0].toLowerCase();
  if (mappedType && allowedTypes.includes(mappedType)) {
    return mappedType;
  }
  if (normalizedType && allowedTypes.includes(normalizedType)) {
    return normalizedType;
  }
  return normalizedType || mappedType || '';
};

const sortMediaItems = (items: MediaItem[], sort: MediaSortOption): MediaItem[] => {
  const sorted = [...items];
  switch (sort) {
    case 'created_asc':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'size_desc':
      return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case 'size_asc':
      return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes);
    case 'created_desc':
    default:
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
};

const MediaLibraryPage: React.FC = () => {
  const { user } = useAuth();
  const canDelete = user?.role === Role.OWNER;

  const [activeTab, setActiveTab] = useState<MediaCategory>(MediaCategory.IMAGE);
  const [sort, setSort] = useState<MediaSortOption>('created_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [uploadQueue, setUploadQueue] = useState<MediaUploadTask[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery, sort, dateFrom, dateTo]);

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listMediaFiles({
        tab: activeTab,
        search: searchQuery || undefined,
        fromDate: dateFrom,
        toDate: dateTo,
        page,
        pageSize,
      });
      setItems(sortMediaItems(response.items, sort));
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, pageSize, sort, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const handleUpload = async (files: File[]) => {
    const tasks = files.map<MediaUploadTask>((file) => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      progress: 0,
      status: 'pending',
    }));
    setUploadQueue((prev) => [...tasks, ...prev]);

    const tabLabel = CATEGORY_TABS.find((tab) => tab.key === activeTab)?.label ?? 'file';
    const allowedExtensions = CATEGORY_EXTENSIONS[activeTab];
    const allowedTypes = CATEGORY_MIME_TYPES[activeTab];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const task = tasks[index];
      const ext = getFileExtension(file.name);
      if (!ext || !allowedExtensions.includes(ext)) {
        setUploadQueue((prev) =>
          prev.map((entry) => (entry.id === task.id ? { ...entry, status: 'error', error: 'Unsupported file type' } : entry))
        );
        continue;
      }

      const maxBytes = MAX_UPLOAD_BYTES[activeTab];
      if (file.size > maxBytes) {
        setUploadQueue((prev) =>
          prev.map((entry) =>
            entry.id === task.id
              ? { ...entry, status: 'error', error: `Max ${formatBytes(maxBytes)} for ${tabLabel}` }
              : entry
          )
        );
        continue;
      }

      const contentType = resolveContentType(file, allowedTypes);
      if (!contentType || !allowedTypes.includes(contentType)) {
        setUploadQueue((prev) =>
          prev.map((entry) =>
            entry.id === task.id ? { ...entry, status: 'error', error: 'Unsupported content type' } : entry
          )
        );
        continue;
      }

      setUploadQueue((prev) => prev.map((entry) => (entry.id === task.id ? { ...entry, status: 'uploading' } : entry)));
      try {
        const presign = await api.presignMediaUpload({
          purpose: 'library',
          tab: activeTab,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
        });
        await api.uploadToPresignedUrl(presign.uploadUrl, file, contentType, (percent) =>
          setUploadQueue((prev) => prev.map((entry) => (entry.id === task.id ? { ...entry, progress: percent } : entry)))
        );
        await api.confirmMediaUpload({ fileId: presign.fileId });
        setUploadQueue((prev) => prev.map((entry) => (entry.id === task.id ? { ...entry, status: 'success', progress: 100 } : entry)));
        await fetchMedia();
      } catch (err) {
        setUploadQueue((prev) =>
          prev.map((entry) =>
            entry.id === task.id
              ? { ...entry, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
              : entry
          )
        );
      }
    }
  };

  const handleDelete = async (mediaId: string) => {
    if (!canDelete) {
      setError('Only the Owner role can delete media files.');
      return;
    }
    if (!window.confirm('Delete this file?')) return;
    try {
      await api.deleteMedia(mediaId);
      setItems((prev) => prev.filter((item) => item.id !== mediaId));
      setTotal((prev) => Math.max(0, prev - 1));
      setSelected((prev) => (prev?.id === mediaId ? null : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete media');
    }
  };

  const handleCopyUrl = async (item: MediaItem) => {
    await navigator.clipboard.writeText(item.readUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const tabExtensions = useMemo(() => CATEGORY_EXTENSIONS[activeTab], [activeTab]);

  if (loading && items.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 text-white">
      <header className="rounded-3xl bg-gradient-to-r from-[#171422] via-[#0B0B15] to-[#051937] p-6 shadow-2xl shadow-indigo-900/40">
        <p className="text-sm uppercase tracking-wide text-indigo-200">Zea Play</p>
        <h1 className="mt-1 text-3xl font-semibold">Media Library</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Upload, version, and edit assets the instant inspiration strikes. Dark-mode native, keyboard-friendly, and ready for every Zea Play module.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              'rounded-full px-4 py-2 text-sm font-semibold transition',
              activeTab === tab.key
                ? 'bg-gradient-to-r text-white ' + tab.accent
                : 'border border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-white'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <MediaToolbar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          sort={sort}
          onSortChange={setSort}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateRangeChange={({ from, to }) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          onResetFilters={() => {
            setSearchInput('');
            setDateFrom(undefined);
            setDateTo(undefined);
            setSort('created_desc');
          }}
        />

      {error && <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <MediaDropzone onUpload={handleUpload} acceptingExtensions={tabExtensions} uploads={uploadQueue} />

      {copiedId && <div className="rounded-full bg-emerald-600/30 px-4 py-2 text-center text-sm text-emerald-100">Copied link to clipboard</div>}

      <MediaGrid
        items={items}
        loading={loading}
        selectedId={selected?.id}
        onSelect={setSelected}
        onDelete={(item) => handleDelete(item.id)}
        onCopyUrl={handleCopyUrl}
        canDelete={canDelete}
      />

      <MediaDetailsDrawer
        item={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        onDelete={handleDelete}
        onCopyUrl={(url) => {
          if (selected) {
            handleCopyUrl(selected);
          } else {
            navigator.clipboard.writeText(url);
          }
        }}
        canDelete={canDelete}
      />
    </div>
  );
};

export default MediaLibraryPage;
