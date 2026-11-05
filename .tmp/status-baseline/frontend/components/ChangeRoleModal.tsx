import React, { useState, useEffect } from 'react';
import api from '../services/mockApi';
import { User, Role } from '../types';
import { useAuth } from '../hooks/useAuth';

interface ChangeRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onRoleChanged: () => void;
}

const ChangeRoleModal: React.FC<ChangeRoleModalProps> = ({ isOpen, onClose, user, onRoleChanged }) => {
    const { user: currentUser } = useAuth();
    const [newRole, setNewRole] = useState<Role>(user.role);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (user) {
            setNewRole(user.role);
        }
    }, [user]);

    const handleClose = () => {
        setError('');
        setIsSubmitting(false);
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) {
            setError('Authentication error.');
            return;
        }
        setIsSubmitting(true);
        setError('');

        try {
            await api.updateUser(user.id, { role: newRole }, currentUser.id);
            onRoleChanged();
            handleClose();
        } catch (err: any) {
            setError(err.message || 'Failed to change role. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)]">
                <h2 className="text-2xl font-semibold text-white">Change Role</h2>
                <p className="mt-1 text-sm text-white/60">
                    for <span className="font-semibold text-white">{user.name}</span>
                </p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="role" className="block text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                            New Role
                        </label>
                        <select
                            id="role"
                            value={newRole}
                            onChange={e => setNewRole(e.target.value as Role)}
                            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-sm outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
                        >
                            <option className="bg-slate-900 text-white" value={Role.USER}>User</option>
                            <option className="bg-slate-900 text-white" value={Role.ADMIN}>Admin</option>
                            <option className="bg-slate-900 text-white" value={Role.MANAGER}>Manager</option>
                            {/* Only owners can promote others to owner */}
                            {currentUser?.role === Role.OWNER && (
                                <option className="bg-slate-900 text-white" value={Role.OWNER}>Owner</option>
                            )}
                        </select>
                    </div>

                    {error && <p className="text-sm text-rose-300">{error}</p>}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ChangeRoleModal;
