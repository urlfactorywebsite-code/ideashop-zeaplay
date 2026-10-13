import React, { useState } from 'react';
import { Attachment } from '../../types';
import { FileText, Image as ImageIcon, Download, ExternalLink, X, FileArchive, FileCode } from 'lucide-react';

interface FileAttachmentPreviewProps {
  attachments: Attachment[];
}

export const FileAttachmentPreview: React.FC<FileAttachmentPreviewProps> = ({ attachments }) => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (type: string, url: string) => {
    return type?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
  };

  const getFileIcon = (type: string, name: string) => {
    if (isImage(type, name)) return <ImageIcon className="w-5 h-5 text-blue-500" />;
    if (name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz'))
      return <FileArchive className="w-5 h-5 text-amber-500" />;
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.json'))
      return <FileCode className="w-5 h-5 text-emerald-500" />;
    return <FileText className="w-5 h-5 text-indigo-500" />;
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map(att => {
          const img = isImage(att.type, att.url);
          if (img) {
            return (
              <div
                key={att.id || att.url}
                className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 max-w-xs cursor-pointer shadow-xs hover:shadow-md transition-shadow"
                onClick={() => setPreviewImage(att.url)}
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="max-h-56 object-cover rounded-xl group-hover:scale-102 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <span className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30">
                    <ExternalLink className="w-4 h-4" />
                  </span>
                  <a
                    href={att.url}
                    download={att.name}
                    onClick={e => e.stopPropagation()}
                    className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
            );
          }

          return (
            <div
              key={att.id || att.url}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 max-w-sm hover:border-blue-400 dark:hover:border-blue-500/50 transition-colors shadow-xs"
            >
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                {getFileIcon(att.type, att.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate" title={att.name}>
                  {att.name}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {formatFileSize(att.size)}
                </p>
              </div>
              <a
                href={att.url}
                download={att.name}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors shrink-0"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          );
        })}
      </div>

      {/* Lightbox Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};
