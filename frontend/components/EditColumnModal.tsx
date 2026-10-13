import React, { useState, useEffect } from 'react';
import api from '../services/mockApi';
import { PencilIcon } from './icons';

interface EditColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  columnId: string | null;
  initialTitle: string;
  onColumnUpdated: () => void;
}

const EditColumnModal: React.FC<EditColumnModalProps> = ({ isOpen, onClose, columnId, initialTitle, onColumnUpdated }) => {
  const [title, setTitle] = useState(initialTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(initialTitle);
    setError('');
  }, [initialTitle, isOpen]);

  const handleClose = () => {
    setTitle(initialTitle);
    setError('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnId) return;
    setIsSubmitting(true);
    setError('');
    try {
      await api.updateKanbanColumn(columnId, { title });
      onColumnUpdated();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update column.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
      <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-md border border-border-color">
        <div className="flex items-center gap-2 mb-6">
          <PencilIcon className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold text-text-primary">Stage Name</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="column-title" className="block text-sm font-medium text-text-secondary" title="The display name of the Kanban column">Column Title</label>
            <input
              type="text"
              id="column-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="e.g., Client Approval"
              title="The display name of the Kanban column"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end space-x-4 pt-4">
            <button type="button" onClick={handleClose} className="py-2 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="py-2 px-4 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditColumnModal;
