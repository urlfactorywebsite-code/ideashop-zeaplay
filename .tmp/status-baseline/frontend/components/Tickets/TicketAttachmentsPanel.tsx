import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpTrayIcon, PaperClipIcon, TrashIcon } from '@heroicons/react/24/outline';
import api from '../../services/api';
import { Ticket, TicketAttachment } from '../../types';

interface TicketAttachmentsPanelProps {
  ticket: Ticket;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const TicketAttachmentsPanel: React.FC<TicketAttachmentsPanelProps> = ({ ticket }) => {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listTicketAttachments(ticket.id);
      setAttachments(data);
    } catch (error) {
      console.error('Failed to load attachments', error);
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

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
      const presign = await api.presignTicketAttachment(ticket.id, {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });

      await api.confirmTicketAttachment(ticket.id, { fileKey: presign.fileKey });
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

  const handleDelete = async (attachmentId: string) => {
    try {
      await api.deleteTicketAttachment(ticket.id, attachmentId);
      await fetchAttachments();
    } catch (error) {
      console.error('Failed to delete attachment', error);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Attachments</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Upload files up to 10MB.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <PaperClipIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {attachment.fileName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(attachment.sizeBytes)} • {new Date(attachment.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(attachment.id)}
                  className="text-red-500 hover:text-red-600"
                  aria-label="Delete attachment"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}

            {attachments.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
                No attachments yet.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Upload files</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Drag files here or click Upload.
            </p>
          </div>
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-950/60 px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
          Drop files here to attach them to this ticket.
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
};

export default TicketAttachmentsPanel;
