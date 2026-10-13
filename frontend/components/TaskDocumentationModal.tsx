import React, { useState } from 'react';
import { QuestionMarkCircleIcon, XMarkIcon } from './icons';

interface TaskDocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TaskDocumentationModal: React.FC<TaskDocumentationModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('content');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [reactions, setReactions] = useState<string[]>([]);

  const handleReaction = (emoji: string) => {
    setReactions(prev => prev.includes(emoji) ? prev.filter(r => r !== emoji) : [...prev, emoji]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <h2 className="text-xl font-semibold text-text-primary">Task Documentation</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-4">
          {/* Title */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-border-color rounded-md bg-background text-text-primary"
              placeholder="Enter title"
            />
          </div>

          {/* Subject */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-border-color rounded-md bg-background text-text-primary"
              placeholder="Enter subject"
            />
          </div>

          {/* Tabs */}
          <div className="flex space-x-4 mb-4 border-b border-border-color">
            <button
              className={`pb-2 px-4 ${
                activeTab === 'content'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('content')}
            >
              Content
            </button>
            <button
              className={`pb-2 px-4 ${
                activeTab === 'notes'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('notes')}
            >
              Notes
            </button>
          </div>

          {/* Editor */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-1">Editor</label>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              className="w-full px-3 py-2 border border-border-color rounded-md bg-background text-text-primary h-32 resize-vertical"
              placeholder="Enter content here..."
            />
          </div>

          {/* Reactions */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-2">Reactions</label>
            <div className="flex space-x-2">
              {['👍', '❤️', '😂', '😮', '😢', '😡'].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className={`px-3 py-1 border rounded-md ${
                    reactions.includes(emoji)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-background text-text-primary border-border-color'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskDocumentationModal;