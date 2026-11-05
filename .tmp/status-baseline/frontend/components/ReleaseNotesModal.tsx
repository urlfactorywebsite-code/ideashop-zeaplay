import React from 'react';
import { XMarkIcon } from './icons';
import { ReleaseNotes, ReleaseNotesMode } from '../types';

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  isOwner: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  releaseNotes: ReleaseNotes | null;
}

const buildPreviewDoc = (notes: ReleaseNotes | null): string => {
  if (!notes) {
    return '<!doctype html><html><body></body></html>';
  }
  const html = notes.html ?? '';
  const css = notes.css ?? '';
  const js = notes.js ?? '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${css}</style>
  </head>
  <body>
    ${html}
    <script>${js}</script>
  </body>
</html>`;
};

const ReleaseNotesModal: React.FC<ReleaseNotesModalProps> = ({
  isOpen,
  onClose,
  onEdit,
  isOwner,
  isLoading,
  errorMessage,
  releaseNotes,
}) => {
  const [activeTab, setActiveTab] = React.useState<'details' | 'preview'>('details');

  React.useEffect(() => {
    if (!isOpen) return;
    const hasCode = Boolean(releaseNotes?.html || releaseNotes?.css || releaseNotes?.js);
    const nextTab = hasCode && releaseNotes?.contentMode === 'code' ? 'preview' : 'details';
    setActiveTab(nextTab);
  }, [isOpen, releaseNotes]);

  if (!isOpen) return null;

  const hasCode = Boolean(releaseNotes?.html || releaseNotes?.css || releaseNotes?.js);
  const updatedAt = releaseNotes?.updatedAt
    ? new Date(releaseNotes.updatedAt).toLocaleString()
    : null;
  const detailsText = releaseNotes?.detailsText?.trim() ?? '';
  const detailLines = detailsText ? detailsText.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  const contentMode: ReleaseNotesMode = releaseNotes?.contentMode ?? 'text';

  const isPreviewOnly = activeTab === 'preview' && hasCode;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-black rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden border border-slate-800 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6 border-b border-slate-800">
          <div>
            <h2 className="text-2xl font-semibold text-white">Product Updates</h2>
            <p className="text-sm text-slate-400">{releaseNotes?.versionLabel ?? 'Zea.Play'}</p>
            {updatedAt && <p className="text-xs text-slate-500">Updated {updatedAt}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasCode && (
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('details')}
                  className={`px-3 py-1.5 rounded-full border ${
                    activeTab === 'details'
                      ? 'bg-blue-500/20 border-blue-400 text-blue-200'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1.5 rounded-full border ${
                    activeTab === 'preview'
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  Live Preview
                </button>
              </div>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={onEdit}
                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-full bg-slate-700 text-white hover:bg-slate-600 transition"
              >
                Edit
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>
        <div className={`p-6 ${isPreviewOnly ? 'overflow-hidden' : 'space-y-4 overflow-y-auto'}`}>
          {isLoading && (
            <div className="text-sm text-slate-300">Loading release notes...</div>
          )}
          {errorMessage && (
            <div className="text-sm text-red-300">Failed to load release notes: {errorMessage}</div>
          )}
          {!isLoading && !errorMessage && !releaseNotes && (
            <div className="text-sm text-slate-300">No release notes available yet.</div>
          )}
          {!isLoading && !errorMessage && releaseNotes && (
            <div className={isPreviewOnly ? '' : 'space-y-6'}>
              {!isPreviewOnly && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span className="uppercase tracking-[0.2em]">Release</span>
                  <span className="rounded-full border border-slate-700 px-2 py-1">{contentMode.toUpperCase()}</span>
                </div>
              )}
              {!isPreviewOnly && (activeTab === 'details' || !hasCode) && (
                <div className="space-y-3 text-sm text-slate-200">
                  {detailLines.length > 0 ? (
                    <ul className="list-disc list-inside space-y-2">
                      {detailLines.map((line, index) => (
                        <li key={`${line}-${index}`}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No update details added yet.</p>
                  )}
                </div>
              )}
              {isPreviewOnly && (
                <iframe
                  title="Release preview"
                  className="w-full h-[70vh] rounded-xl border-0 bg-white"
                  sandbox="allow-scripts"
                  srcDoc={buildPreviewDoc(releaseNotes)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReleaseNotesModal;
