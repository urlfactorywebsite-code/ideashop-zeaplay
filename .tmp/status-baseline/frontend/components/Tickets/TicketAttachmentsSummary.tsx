import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpTrayIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import api from '../../services/api';
import { TicketAttachment } from '../../types';

interface TicketAttachmentsSummaryProps {
  ticketId: string;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const TicketAttachmentsSummary: React.FC<TicketAttachmentsSummaryProps> = ({ ticketId }) => {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listTicketAttachments(ticketId);
      setAttachments(data);
    } catch (error) {
      console.error('Failed to load attachments', error);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const presign = await api.presignTicketAttachment(ticketId, {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });

      await api.confirmTicketAttachment(ticketId, { fileKey: presign.fileKey });
      await fetchAttachments();
    } catch (error) {
      console.error('Failed to upload attachment', error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gray-400">Attachments</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            {attachments.length} files
          </p>
        </div>
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-200 disabled:opacity-60"
        >
          <ArrowUpTrayIcon className="h-3.5 w-3.5" />
          {uploading ? 'Uploading' : 'Upload'}
        </button>
      </div>

      {loading && (
        <div className="mt-3 flex items-center justify-center rounded-lg border border-gray-200/60 bg-white/70 py-6 dark:border-gray-700/60 dark:bg-gray-900/60">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      )}

      {!loading && attachments.length === 0 && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No attachments yet.</p>
      )}

      {!loading && attachments.length > 0 && (
        <div className="mt-3 space-y-2">
          {attachments.slice(0, 4).map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-3 rounded-xl border border-gray-200/50 bg-white/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-900/60">
              <PaperClipIcon className="h-4 w-4 text-gray-400" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                  {attachment.fileName}
                </p>
                <p className="text-[11px] text-gray-400">{formatBytes(attachment.sizeBytes)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
    </div>
  );
};

export default TicketAttachmentsSummary;
