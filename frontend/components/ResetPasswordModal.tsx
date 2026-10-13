
import React, { useState } from 'react';
import api from '../services/mockApi';
import { User } from '../types';
import { EyeIcon, EyeSlashIcon } from './icons';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ isOpen, onClose, user }) => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const resetForm = () => {
        setNewPassword('');
        setConfirmPassword('');
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setError('');
        setSuccess('');
        setIsSubmitting(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters long.");
            return;
        }
        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            await api.resetPassword(user.id, newPassword);
            setSuccess(`Password for ${user.name} has been reset successfully.`);
            setTimeout(handleClose, 2000); // Close modal after 2 seconds
        } catch (err) {
            setError('Failed to reset password. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
            <div className="w-full max-w-md rounded-lg border border-white/20 bg-slate-950 p-6 shadow-2xl">
                <h2 className="mb-2 text-2xl font-bold text-white">Reset Password</h2>
                <p className="mb-6 text-slate-200">for <span className="font-semibold text-white">{user.name}</span></p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-slate-100">New Password</label>
                        <div className="relative mt-1">
                            <input 
                                type={showNewPassword ? "text" : "password"}
                                id="new-password" 
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                required 
                                minLength={8}
                                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-950 shadow-sm caret-blue-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-800"
                                aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                            >
                                {showNewPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-100">Confirm New Password</label>
                        <div className="relative mt-1">
                            <input 
                                type={showConfirmPassword ? "text" : "password"}
                                id="confirm-password" 
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-950 shadow-sm caret-blue-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                             <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-800"
                                aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                            >
                                {showConfirmPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>

                    {error && <p className="text-sm font-medium text-red-300">{error}</p>}
                    {success && <p className="text-sm font-medium text-emerald-300">{success}</p>}

                    <div className="flex justify-end gap-4 pt-4">
                        <button type="button" onClick={handleClose} className="rounded-md bg-slate-200 px-4 py-2 text-slate-800 transition-colors hover:bg-white">
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting || !!success} className="rounded-md bg-blue-600 px-4 py-2 text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50">
                            {isSubmitting ? 'Resetting...' : 'Reset Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ResetPasswordModal;
