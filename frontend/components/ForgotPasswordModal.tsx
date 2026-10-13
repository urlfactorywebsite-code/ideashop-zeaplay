import React, { useState } from 'react';
import api from '../services/mockApi';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose }) => {
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setMessage('');
        try {
            await api.forgotPassword(email);
            setMessage('If an account with this email exists, a password reset link has been sent.');
        } catch (error) {
            // Even on error, show a generic message for security
            setMessage('If an account with this email exists, a password reset link has been sent.');
        } finally {
            setIsSubmitting(false);
            setEmail('');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
            <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-md border border-border-color relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                <div className="text-center mb-6">
                    <h2 className="text-2xl font-bold text-text-primary">Forgot Password?</h2>
                    <p className="text-text-secondary mt-2">Enter your email address and we'll send you instructions to reset your password.</p>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="forgot-email" className="sr-only">Email address</label>
                        <input
                            id="forgot-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-600 bg-background placeholder-gray-400 text-text-primary focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                            placeholder="Email address"
                        />
                    </div>

                    {message && (
                        <div className="p-3 bg-green-900 border border-green-700 rounded-md">
                           <p className="text-sm text-green-200">{message}</p>
                        </div>
                    )}

                    <div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                        >
                            {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ForgotPasswordModal;
