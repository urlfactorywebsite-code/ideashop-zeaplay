import React, { useEffect, useRef, useState } from 'react';
import { PaperAirplaneIcon, PaperClipIcon, XMarkIcon } from '../../../components/icons';
import { ChatAttachment, ChatMessage } from '../types';

type Props = {
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
  replyTo?: ChatMessage | null;
  onCancelReply?: () => void;
  onSend: (content: string, options?: { replyToMessageId?: string | null; attachments?: ChatAttachment[] }) => Promise<void> | void;
  onTyping?: (typing: boolean) => void;
  onUploadAttachment?: (file: File, onProgress?: (progress: number) => void) => Promise<ChatAttachment>;
};

const pickerEmojis = ['👍', '🎉', '✨', '✅', '👀', '💜', '🔥', '🚀', '😊', '🙌', '💡', '📌'];

const MessageComposer: React.FC<Props> = ({ disabled, disabledReason, placeholder, replyTo, onCancelReply, onSend, onTyping, onUploadAttachment }) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const typingTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEmojiOpen(false);
        onCancelReply?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancelReply]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = content.trim();
    if ((!next && attachments.length === 0) || disabled) return;
    setContent('');
    const files = attachments;
    setAttachments([]);
    onTyping?.(false);
    try {
      await onSend(next, { replyToMessageId: replyTo?.id ?? null, attachments: files });
      onCancelReply?.();
    } catch {
      setContent(next);
      setAttachments(files);
    }
  };

  const handleTyping = (value: string) => {
    setContent(value);
    onTyping?.(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => onTyping?.(false), 1200);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!onUploadAttachment || disabled) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const attachment = await onUploadAttachment(file, setUploadProgress);
        setAttachments((current) => [...current, attachment]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const insertText = (value: string) => {
    setContent((current) => `${current}${value}`);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void uploadFiles(event.dataTransfer.files);
      }}
      className="chat-composer"
    >
      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-zinc-200">
          <span className="truncate">Replying to {replyTo.sender?.name ?? replyTo.senderName ?? 'Unknown User'}: {(replyTo.content ?? '').slice(0, 96)}</span>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply} className="rounded-full p-1 font-semibold text-zinc-400 hover:bg-white/10 hover:text-white">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span key={attachment.id || attachment.storageKey || attachment.url || attachment.originalFileName} className="rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold text-zinc-200">
              {attachment.originalFileName ?? attachment.fileName ?? 'Attachment'}
            </span>
          ))}
        </div>
      )}

      {uploading && <div className="mb-2 h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
      {uploadError && <div className="mb-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200">{uploadError}</div>}
      {disabledReason && <div className="mb-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">{disabledReason}</div>}

      <div className="chat-composer-box">
        <div className="mb-1 flex items-center gap-1 px-1">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => event.target.files && void uploadFiles(event.target.files)} />
          <button type="button" aria-label="Attach files" disabled={disabled || uploading} onClick={() => fileInputRef.current?.click()} className="chat-composer-tool">
            <PaperClipIcon className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Open emoji picker" disabled={disabled} onClick={() => setEmojiOpen((value) => !value)} className="chat-composer-tool text-sm font-black">
            :)
          </button>
          <button type="button" aria-label="Insert mention" disabled={disabled} onClick={() => insertText('@')} className="chat-composer-tool text-sm font-black">
            @
          </button>
          <span className="ml-auto hidden text-sm text-zinc-300 sm:inline">Shift+Enter for a new line</span>
        </div>

        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 grid grid-cols-6 gap-1 rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
            {pickerEmojis.map((emoji) => (
              <button key={emoji} type="button" onClick={() => insertText(emoji)} className="grid h-8 w-8 place-items-center rounded-xl text-lg hover:bg-zinc-800">{emoji}</button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => handleTyping(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? 'Select a conversation' : placeholder ?? 'Message this chat'}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base text-white outline-none placeholder:text-zinc-300"
          />
          <button type="submit" aria-label="Send message" disabled={disabled || uploading || (!content.trim() && attachments.length === 0)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-800 text-zinc-300 transition hover:bg-sky-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </form>
  );
};

export default MessageComposer;
