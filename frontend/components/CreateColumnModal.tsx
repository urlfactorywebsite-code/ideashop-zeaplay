import React, { useState } from 'react';
import api from '../services/mockApi';

interface CreateColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onColumnCreated: () => void;
}

const CreateColumnModal: React.FC<CreateColumnModalProps> = ({ isOpen, onClose, onColumnCreated }) => {
    const [title, setTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const resetForm = () => {
        setTitle('');
        setError('');
        setIsSubmitting(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        try {
            await api.createKanbanColumn(title);
            onColumnCreated();
            handleClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create column.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
            <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-md border border-border-color">
                <h2 className="text-2xl font-bold mb-6 text-text-primary">Create New Column</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="column-title" className="block text-sm font-medium text-text-secondary">Column Title</label>
                        <input
                            type="text"
                            id="column-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            required
                            className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                            placeholder="e.g., Client Approval"
                        />
                    </div>

                    {error && <p className="text-red-500 text-sm">{error}</p>}

                    <div className="flex justify-end space-x-4 pt-4">
                        <button type="button" onClick={handleClose} className="py-2 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="py-2 px-4 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
                            {isSubmitting ? 'Creating...' : 'Create Column'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateColumnModal;
