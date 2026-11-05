import React from 'react';
import { XMarkIcon } from './icons';
import { ReleaseNotes, ReleaseNotesMode, ReleaseNotesUpdate } from '../types';

interface ReleaseNotesEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: ReleaseNotesUpdate) => Promise<void>;
  isSaving: boolean;
  releaseNotes: ReleaseNotes | null;
}

const buildPreviewDoc = (html: string, css: string, js: string): string => `<!doctype html>
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

const ReleaseNotesEditorModal: React.FC<ReleaseNotesEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isSaving,
  releaseNotes,
}) => {
  const [versionLabel, setVersionLabel] = React.useState('');
  const [contentMode, setContentMode] = React.useState<ReleaseNotesMode>('text');
  const [detailsText, setDetailsText] = React.useState('');
  const [html, setHtml] = React.useState('');
  const [css, setCss] = React.useState('');
  const [js, setJs] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'html' | 'css' | 'js'>('html');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setVersionLabel(releaseNotes?.versionLabel ?? 'Zea.Play V6.0.1');
    setContentMode(releaseNotes?.contentMode ?? 'text');
    setDetailsText(releaseNotes?.detailsText ?? '');
    setHtml(releaseNotes?.html ?? '');
    setCss(releaseNotes?.css ?? '');
    setJs(releaseNotes?.js ?? '');
    setActiveTab('html');
    setErrorMessage(null);
  }, [isOpen, releaseNotes]);

  if (!isOpen) return null;

  const handleFileUpload = (type: 'html' | 'css' | 'js') => async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    if (type === 'html') setHtml(content);
    if (type === 'css') setCss(content);
    if (type === 'js') setJs(content);
    event.target.value = '';
  };

  const handleSave = async () => {
    setErrorMessage(null);
    if (!versionLabel.trim()) {
      setErrorMessage('Version label is required.');
      return;
    }
    try {
      await onSave({
        versionLabel: versionLabel.trim(),
        contentMode,
        detailsText,
        html,
        css,
        js,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save release notes.';
      setErrorMessage(message);
    }
  };

  const previewDoc = buildPreviewDoc(html, css, js);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden border border-slate-800">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-2xl font-semibold text-white">Edit Release Notes</h2>
            <p className="text-sm text-slate-400">Choose text or code for the update content.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[78vh]">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] items-center">
            <div>
              <label className="block text-xs uppercase tracking-[0.3em] text-slate-400">Version Label</label>
              <input
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="Zea.Play V6.0.1"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setContentMode('text')}
                className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wide border ${
                  contentMode === 'text'
                    ? 'bg-blue-500/20 border-blue-400 text-blue-200'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setContentMode('code')}
                className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wide border ${
                  contentMode === 'code'
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                Code
              </button>
            </div>
          </div>

          {contentMode === 'text' && (
            <div>
              <label className="block text-xs uppercase tracking-[0.3em] text-slate-400">Update Details</label>
              <textarea
                value={detailsText}
                onChange={(event) => setDetailsText(event.target.value)}
                className="mt-2 w-full min-h-[200px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="Add update notes. Use new lines for bullet points."
              />
            </div>
          )}

          {contentMode === 'code' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3">
                <label className="cursor-pointer rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-200 hover:border-blue-400">
                  Upload HTML
                  <input type="file" accept=".html,text/html" className="hidden" onChange={handleFileUpload('html')} />
                </label>
                <label className="cursor-pointer rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-200 hover:border-emerald-400">
                  Upload CSS
                  <input type="file" accept=".css,text/css" className="hidden" onChange={handleFileUpload('css')} />
                </label>
                <label className="cursor-pointer rounded-full border border-slate-700 px-4 py-2 text-xs text-slate-200 hover:border-yellow-400">
                  Upload JS
                  <input type="file" accept=".js,text/javascript" className="hidden" onChange={handleFileUpload('js')} />
                </label>
              </div>

              <div className="flex gap-2 text-xs">
                {(['html', 'css', 'js'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-full border ${
                      activeTab === tab
                        ? 'bg-slate-700 border-slate-500 text-white'
                        : 'border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>

              {activeTab === 'html' && (
                <textarea
                  value={html}
                  onChange={(event) => setHtml(event.target.value)}
                  className="w-full min-h-[220px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                  placeholder="Paste HTML here."
                />
              )}
              {activeTab === 'css' && (
                <textarea
                  value={css}
                  onChange={(event) => setCss(event.target.value)}
                  className="w-full min-h-[220px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                  placeholder="Paste CSS here."
                />
              )}
              {activeTab === 'js' && (
                <textarea
                  value={js}
                  onChange={(event) => setJs(event.target.value)}
                  className="w-full min-h-[220px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/60"
                  placeholder="Paste JS here."
                />
              )}

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live Preview</p>
                <iframe
                  title="Release editor preview"
                  className="w-full h-72 rounded-xl border border-slate-800 bg-white"
                  sandbox="allow-scripts"
                  srcDoc={previewDoc}
                />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="text-sm text-red-300">{errorMessage}</div>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-lg bg-blue-500 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Updates'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseNotesEditorModal;
