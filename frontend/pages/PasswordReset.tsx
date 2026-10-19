import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import api from '../services/mockApi';
import { useAuth } from '../hooks/useAuth';
import { passwordError } from '../utils/passwordReset';
import '../components/PasswordRecovery.css';

export default function PasswordReset() {
    const location = useLocation();
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [token, setToken] = useState(() => new URLSearchParams(location.search).get('token') || '');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [show, setShow] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const pending = useRef<AbortController | null>(null);
    useEffect(() => {
        const incoming = new URLSearchParams(location.search).get('token');
        if (incoming) {
            pending.current?.abort();
            setToken(incoming); setDone(false); setBusy(false); setError('');
            setPassword(''); setConfirmation('');
            navigate('/reset-password', { replace: true });
        }
    }, [location.search, navigate]);
    useEffect(() => () => pending.current?.abort(), []);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || !token) return;
        const validation = passwordError(password, confirmation);
        if (validation) { setError(validation); return; }
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true); setError('');
        try {
            await api.completePasswordReset(token, password, controller.signal);
            if (!controller.signal.aborted) { setDone(true); setPassword(''); setConfirmation(''); }
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to reset your password. Please try again.');
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    return <main className="password-recovery recovery-shell">
        <section className="recovery-panel" aria-labelledby="reset-heading">
            <p className="recovery-brand">Zea.Play</p>
            <h1 id="reset-heading">Reset Password</h1>
            {done ? <p role="status">Your password has been updated. Sign in with your new password.</p> : !token ?
                <p role="alert">This reset link is missing or invalid. Request a new link from the login page.</p> :
                <form onSubmit={submit} aria-busy={busy}>
                    <div><label htmlFor="reset-new">New password</label>
                        <div className="recovery-password"><input id="reset-new" type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72}
                            value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
                            <button type="button" onClick={() => setShow(value => !value)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} className="recovery-visibility">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                        </div></div>
                    <div><label htmlFor="reset-confirm">Confirm password</label>
                        <input id="reset-confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72}
                            value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></div>
                    {error && <p role="alert">{error}</p>}
                    <button type="submit" disabled={busy} className="recovery-submit">{busy ? 'Updating...' : 'Update password'}</button>
                </form>}
            <button type="button" onClick={logout} className="recovery-back">Back to login</button>
        </section>
    </main>;
}
