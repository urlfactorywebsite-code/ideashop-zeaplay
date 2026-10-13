import React from 'react';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import { MediaUploadTask } from '../../types';

type MediaDropzoneProps = {
  onUpload: (files: File[]) => void;
  acceptingExtensions: string[];
  uploads: MediaUploadTask[];
  disabled?: boolean;
};

const MediaDropzone: React.FC<MediaDropzoneProps> = ({ onUpload, acceptingExtensions, uploads, disabled }) => {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    noClick: true,
    multiple: true,
    disabled,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length) {
        onUpload(acceptedFiles);
      }
    },
  });

  return (
    <div className="rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/60 p-5 shadow-inner shadow-slate-900/60">
      <div
        {...getRootProps()}
        className={clsx(
          'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700/80 px-6 py-10 text-center transition',
          isDragActive ? 'border-indigo-500 bg-indigo-500/10' : 'hover:border-indigo-400/70 hover:bg-slate-900/80',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 text-indigo-300">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-white">Drag & Drop files</p>
          <p className="text-sm text-slate-400">or</p>
          <button
            type="button"
            onClick={open}
            disabled={disabled}
            className="rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Browse files
          </button>
        </div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Accepted: {acceptingExtensions.map((ext) => `.${ext}`).join(', ')}
        </p>
      </div>

      {uploads.length > 0 && (
        <div className="mt-5 space-y-3">
          {uploads.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl border border-slate-800/70 bg-slate-900/80 p-3 shadow shadow-slate-900/40"
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-white">{task.fileName}</span>
                <span className="text-xs text-slate-400">
                  {task.status === 'error'
                    ? 'Failed'
                    : task.status === 'success'
                    ? 'Completed'
                    : `${task.progress}%`}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    task.status === 'error'
                      ? 'bg-red-500'
                      : task.status === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
                  )}
                  style={{ width: `${task.status === 'error' ? 100 : task.progress}%` }}
                />
              </div>
              {task.error && <p className="mt-1 text-xs text-red-400">{task.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaDropzone;
