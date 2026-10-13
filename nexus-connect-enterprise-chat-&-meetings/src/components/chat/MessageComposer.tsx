import React, { useState, useRef, useEffect } from 'react';
import { Attachment, Message } from '../../types';
import { api } from '../../services/api';
import { EmojiPicker } from '../common/EmojiPicker';
import {
  Send,
  Paperclip,
  Smile,
  Bold,
  Italic,
  Code,
  List,
  Quote,
  X,
  CornerDownRight,
  Edit2,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';

interface MessageComposerProps {
  conversationName: string;
  replyingToMessage: Message | null;
  editingMessage: Message | null;
  onSendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  onEditMessage: (messageId: string, newContent: string) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  conversationName,
  replyingToMessage,
  editingMessage,
  onSendMessage,
  onEditMessage,
  onCancelReply,
  onCancelEdit,
  onStartTyping,
  onStopTyping,
}) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // When editing a message, populate text
  useEffect(() => {
    if (editingMessage) {
      setContent(editingMessage.content);
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    onStartTyping();

    // Auto-adjust textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() && attachments.length === 0) return;

    if (editingMessage) {
      onEditMessage(editingMessage.id, content.trim());
      setContent('');
      onCancelEdit();
    } else {
      await onSendMessage(content.trim(), attachments);
      setContent('');
      setAttachments([]);
      onStopTyping();
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await api.uploadFile(file);
        setAttachments(prev => [...prev, res]);
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Formatting helpers
  const applyFormatting = (prefix: string, suffix = prefix) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = content;
    const selected = text.slice(start, end);

    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setContent(newText);
    textareaRef.current.focus();
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  return (
    <div
      onDragOver={e => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 transition-colors ${
        isDragging ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-400' : ''
      }`}
    >
      {/* Replying Banner */}
      {replyingToMessage && (
        <div className="flex items-center justify-between p-2 mb-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-900/60 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <CornerDownRight className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="font-semibold text-blue-900 dark:text-blue-300">Replying to message:</span>
            <span className="text-slate-600 dark:text-slate-400 truncate max-w-sm">
              {replyingToMessage.content}
            </span>
          </div>
          <button
            onClick={onCancelReply}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Editing Banner */}
      {editingMessage && (
        <div className="flex items-center justify-between p-2 mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/60 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Edit2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="font-semibold text-amber-900 dark:text-amber-300">Editing message</span>
          </div>
          <button
            onClick={onCancelEdit}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            >
              {att.type.startsWith('image/') ? (
                <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-indigo-500" />
              )}
              <span className="truncate max-w-[150px]">{att.name}</span>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                className="text-slate-400 hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer Container */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
        {/* Formatting Toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-slate-200/60 dark:border-slate-800/60 text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => applyFormatting('**')}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="Bold (**text**)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('*')}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="Italic (*text*)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('`')}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="Code (`code`)"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('- ')}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('> ')}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="Quote"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-800 mx-1" />

          {/* File Attachment Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={e => handleFileUpload(e.target.files)}
            className="hidden"
            multiple
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
            title="Attach file or image"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> : <Paperclip className="w-3.5 h-3.5" />}
          </button>

          {/* Emoji Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
              title="Insert Emoji"
            >
              <Smile className="w-3.5 h-3.5" />
            </button>

            {showEmojiPicker && (
              <div className="absolute left-0 bottom-8 z-50">
                <EmojiPicker
                  onSelect={emoji => {
                    setContent(prev => prev + emoji);
                    setShowEmojiPicker(false);
                    textareaRef.current?.focus();
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Input Textarea & Send button */}
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={`Message ${conversationName}... (Enter to send, Shift+Enter for newline)`}
            className="w-full text-xs bg-transparent border-none focus:outline-hidden text-slate-800 dark:text-slate-100 placeholder-slate-400 resize-none max-h-44 leading-relaxed"
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={(!content.trim() && attachments.length === 0) || isUploading}
            className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
            title="Send Message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
