import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { ChatAttachment } from '../types';
import { chatService } from '../services/chatService';
import { formatStorageMB, isProtectedChatFile } from '../utils/storage';

type Props = { attachment: ChatAttachment; compact?: boolean; downloadOnly?: boolean };

const ChatAttachmentView: React.FC<Props> = ({ attachment, compact = false, downloadOnly = false }) => {
  const image = /^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const name = attachment.originalFileName || attachment.fileName;
  useEffect(() => {
    if (!image || downloadOnly || !container.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [image, downloadOnly]);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setError(false);
    setSource(null);
    if (image && !downloadOnly && visible && attachment.url) {
      if (isProtectedChatFile(attachment.url)) {
        void chatService.getFile(attachment.url, controller.signal).then(blob => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setSource(objectUrl);
        }).catch(() => { if (active) setError(true); });
      } else if (/^(https?:\/\/|blob:|\/uploads\/)/.test(attachment.url)) {
        setSource(attachment.url);
      } else setError(true);
    }
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.url, image, downloadOnly, visible]);

  const download = async () => {
    if (!attachment.url || downloading) return;
    setDownloading(true);
    setError(false);
    let objectUrl: string | undefined;
    try {
      let url = source;
      if (!url && isProtectedChatFile(attachment.url)) {
        objectUrl = URL.createObjectURL(await chatService.getFile(attachment.url));
        url = objectUrl;
      } else if (!url && /^(https?:\/\/|\/uploads\/)/.test(attachment.url)) url = attachment.url;
      if (!url) throw new Error('File unavailable');
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.rel = 'noreferrer';
      link.click();
    } catch { setError(true); }
    finally {
      setDownloading(false);
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
    }
  };

  if (image && !downloadOnly) return (
    <div ref={container} className={`overflow-hidden rounded-xl border border-slate-400/30 ${compact ? 'w-28' : 'max-w-xs'}`}>
      {error ? <p className="p-3 text-xs text-slate-400">Image no longer available</p> : source ? (
        <a href={source} target="_blank" rel="noreferrer" title={`Open ${name}`}>
          <img src={source} alt={name} loading="lazy" className={compact ? 'h-20 w-full object-cover' : 'max-h-56 max-w-full object-contain'} onError={() => setError(true)} />
        </a>
      ) : <span className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" /></span>}
      <button type="button" onClick={() => void download()} className="flex w-full items-center gap-1 truncate p-1.5 text-left text-[10px]" title={`Download ${name}`}>
        <Download className="h-3 w-3 shrink-0" /><span className="truncate">{name}</span>
      </button>
    </div>
  );
  return (
    <button type="button" onClick={() => void download()} disabled={downloading} className="flex max-w-full items-center gap-3 rounded-xl border border-slate-400/30 p-2.5 text-left text-xs" title={`Download ${name}`}>
      {downloading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileText className="h-4 w-4 shrink-0" />}
      <span className="min-w-0"><span className="block truncate font-semibold">{name}</span><span className="text-[10px] opacity-70">{error ? 'File no longer available' : formatStorageMB(attachment.fileSize)}</span></span>
      <Download className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
};

export default ChatAttachmentView;
