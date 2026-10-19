import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';
import api from '../services/mockApi';
import './PasswordRecovery.css';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose }) => {
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const pending = useRef<AbortController | null>(null);
    useEffect(() => {
        setMessage(''); setError(''); setEmail(''); setIsSubmitting(false);
        return () => pending.current?.abort();
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        const controller = new AbortController();
        pending.current = controller;
        setIsSubmitting(true);
        setMessage('');
        setError('');
        try {
            await api.forgotPassword(email, controller.signal);
            if (!controller.signal.aborted) setMessage('If an active account matches this email, reset instructions will be emailed shortly.');
        } catch (error) {
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to request a reset. Please try again later.');
        } finally {
            if (!controller.signal.aborted) setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onClose={onClose} className="password-recovery recovery-modal">
          <DialogBackdrop className="recovery-backdrop" />
          <div className="recovery-position">
            <DialogPanel className="recovery-panel">
                <button type="button" onClick={onClose} title="Close password recovery" aria-label="Close password recovery" className="recovery-close"><X size={18} /></button>
                <div>
                    <DialogTitle>Forgot Password?</DialogTitle>
                </div>
                
                <form onSubmit={handleSubmit} aria-busy={isSubmitting}>
                    <div>
                        <label htmlFor="forgot-email">Email address</label>
                        <input
                            id="forgot-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            disabled={isSubmitting}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email address"
                        />
                    </div>

                    {message && (
                        <div>
                           <p role="status">{message}</p>
                        </div>
                    )}
                    {error && <p role="alert">{error}</p>}

                    <div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="recovery-submit"
                        >
                            {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                        </button>
                    </div>
                </form>
            </DialogPanel>
          </div>
        </Dialog>
    );
};

export default ForgotPasswordModal;
