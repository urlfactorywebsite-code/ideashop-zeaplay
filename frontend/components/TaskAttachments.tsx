import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Download, ExternalLink, File, FileImage, FileText, Link2, Mail, X } from 'lucide-react';
import { attachmentBytes, attachmentInfo, attachmentPreviewMime, safeAttachmentUrl, type AttachmentKind } from '../utils/taskAttachments';
import './TaskAttachments.css';

type Attachment = { url: string; file?: File };
const iconFor = (kind: AttachmentKind, extension: string) => extension === 'eml' ? Mail : kind === 'image' ? FileImage : kind === 'pdf' || kind === 'text' ? FileText : kind === 'link' ? Link2 : File;

function AttachmentCard({ attachment, index, onOpen, onRemove, disabled }: {
  attachment: Attachment; index: number; onOpen: (opener: HTMLButtonElement) => void;
  onRemove?: (index: number) => void; disabled?: boolean;
}) {
  const info = attachmentInfo(attachment.url, attachment.file);
  const Icon = iconFor(info.kind, info.extension);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
    if (info.kind !== 'image') { setThumbnail(null); return; }
    if (attachment.file) {
      const url = URL.createObjectURL(attachment.file);
      setThumbnail(url);
      return () => URL.revokeObjectURL(url);
    }
    const url = safeAttachmentUrl(attachment.url);
    // Remote links are fetched only after the user chooses to preview them.
    setThumbnail(url && new URL(url).origin === window.location.origin ? url : null);
  }, [attachment.url, attachment.file, info.kind]);
  return <li className="task-attachment-card" data-kind={info.kind}>
    <button type="button" className="task-attachment-open" onClick={event => onOpen(event.currentTarget)}
      aria-label={`Preview attachment ${info.name}`} title={info.name}>
      <span className="task-attachment-icon" aria-hidden="true">
        {thumbnail && !imageFailed ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <Icon size={25} />}
      </span>
      <span className="task-attachment-copy"><strong>{info.name}</strong>
        <span className="task-attachment-details"><span className="task-attachment-type">{info.label}</span><span>{attachmentBytes(info.size) || info.description}</span></span>
        <small>Click to preview</small>
      </span>
    </button>
    {onRemove && <button type="button" className="task-attachment-remove" disabled={disabled} onClick={() => onRemove(index)}
      aria-label={`Remove attachment ${index + 1}`} title={`Remove ${info.name}`}><X size={15} aria-hidden="true" /></button>}
  </li>;
}

type PreviewState = { loading: boolean; url?: string; mime?: string; text?: string; truncated?: boolean; error?: string };

function AttachmentPreview({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const info = attachmentInfo(attachment.url, attachment.file);
  const safeUrl = safeAttachmentUrl(attachment.url);
  const [state, setState] = useState<PreviewState>({ loading: true });
  const [retry, setRetry] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setState({ loading: true });
    const load = async () => {
      if (!safeUrl) { setState({ loading: false, error: 'This attachment link is not supported.' }); return; }
      if (info.kind === 'file') { setState({ loading: false }); return; }
      try {
        let blob: Blob;
        if (attachment.file) blob = attachment.file;
        else {
          const response = await fetch(safeUrl, { signal: controller.signal,
            credentials: new URL(safeUrl).origin === window.location.origin ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw new Error('Unavailable');
          blob = await response.blob();
        }
        const mime = await attachmentPreviewMime(blob);
        if (controller.signal.aborted) return;
        if (mime) {
          objectUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
          setState({ loading: false, url: objectUrl, mime });
        } else if (info.kind === 'text' || /^(text\/plain|text\/csv|application\/json|message\/rfc822)(;|$)/i.test(blob.type)) {
          const text = await blob.slice(0, 1_000_000).text();
          if (!controller.signal.aborted) setState({ loading: false, text, truncated: blob.size > 1_000_000 });
        } else setState({ loading: false });
      } catch {
        if (!controller.signal.aborted) setState({ loading: false, error: 'Unable to load this preview. Retry or open the original file.' });
      }
    };
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.url, attachment.file, safeUrl, info.kind, retry]);

  return <Dialog open onClose={onClose} initialFocus={closeRef} className="task-attachment-preview" transition>
    <DialogBackdrop className="task-attachment-preview-backdrop" transition />
    <div className="task-attachment-preview-position"><DialogPanel className="task-attachment-preview-panel" transition>
      <header className="task-attachment-preview-header">
        <div><DialogTitle>{info.name}</DialogTitle><p>{info.label} · {attachmentBytes(info.size) || info.description}</p></div>
        <button ref={closeRef} type="button" className="task-attachment-preview-close" onClick={onClose} aria-label="Close attachment preview"><X size={21} aria-hidden="true" /></button>
      </header>
      <div className="task-attachment-preview-body">
        {state.loading ? <p role="status">Loading preview…</p>
          : state.error ? <div className="task-attachment-preview-message"><p role="alert">{state.error}</p>{safeUrl && <button type="button" onClick={() => setRetry(current => current + 1)}>Retry preview</button>}</div>
          : state.mime === 'application/pdf' && state.url ? <iframe title={`PDF preview: ${info.name}`} src={state.url} referrerPolicy="no-referrer" className="task-attachment-preview-pdf" />
          : state.url ? <img src={state.url} alt={info.name} className="task-attachment-preview-image" onError={() => setState(current => ({ ...current, url: undefined, error: 'This image could not be displayed. Open the original file.' }))} />
          : state.text !== undefined ? <div className="task-attachment-preview-text"><pre>{state.text}</pre>{state.truncated && <p>Preview shortened. Download the file to read all content.</p>}</div>
          : <p>In-page preview is not available for this file type. Open or download the original file.</p>}
      </div>
      {safeUrl && <footer className="task-attachment-preview-footer">
        <a href={state.url || safeUrl} download={info.name} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Download size={16} aria-hidden="true" />Download file</a>
        <a href={safeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={16} aria-hidden="true" />Open original</a>
      </footer>}
    </DialogPanel></div>
  </Dialog>;
}

export default function TaskAttachments({ attachments, files = {}, onRemove, disabled }: {
  attachments: string[]; files?: Record<string, File>; onRemove?: (index: number) => void; disabled?: boolean;
}) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setPreview(null);
    window.requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
  };
  useEffect(() => {
    if (preview && !attachments.includes(preview.url)) setPreview(null);
  }, [attachments, preview]);
  return <>
    <ul className="task-attachment-grid" aria-label="Task attachments">{attachments.map((url, index) =>
      <AttachmentCard key={`${url}-${index}`} attachment={{ url, file: files[url] }} index={index} onRemove={onRemove} disabled={disabled}
        onOpen={button => { opener.current = button; setPreview({ url, file: files[url] }); }} />)}
    </ul>
    {preview && <AttachmentPreview attachment={preview} onClose={close} />}
  </>;
}
