import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Gamepad2, LoaderCircle, LockKeyhole, Mail, Pause, Play, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AnimatedLoginBackground from '../components/login/AnimatedLoginBackground';
import LoginConsoleEffects from '../components/login/LoginConsoleEffects';
import { LoginAudio } from '../components/login/loginAudio';
import './Login.css';

const ForgotPasswordModal = React.lazy(() => import('../components/ForgotPasswordModal'));

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isForgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const [recoveryRequested, setRecoveryRequested] = useState(false);
    const recoveryButton = useRef<HTMLButtonElement>(null);
    const [motionPaused, setMotionPaused] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const [soundEnabled, setSoundEnabled] = useState(false);
    const [soundNotice, setSoundNotice] = useState('Sound is off.');
    const pageRoot = useRef<HTMLDivElement>(null);
    const audio = useRef<LoginAudio | null>(null);
    const soundIntent = useRef(false);
    const mounted = useRef(false);
    const submitting = useRef(false);

    useEffect(() => {
        // The dialog's focus tracker loads on demand, after the opening click.
        if (recoveryRequested && !isForgotPasswordOpen) recoveryButton.current?.focus();
    }, [recoveryRequested, isForgotPasswordOpen]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            audio.current?.dispose();
            audio.current = null;
        };
    }, []);

    const toggleSound = async () => {
        const intended = !soundIntent.current;
        soundIntent.current = intended;
        audio.current ??= new LoginAudio();
        const enabled = await audio.current.setEnabled(intended);
        if (!mounted.current || intended !== soundIntent.current) return;
        setSoundEnabled(enabled);
        if (!enabled) soundIntent.current = false;
        setSoundNotice(!intended ? 'Sound is off.' : enabled ? 'Interaction sound is on.' : 'Sound is unavailable in this browser.');
    };

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReducedMotion(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    useEffect(() => {
        const update = () => {
            if (pageRoot.current) pageRoot.current.dataset.pageHidden = String(document.hidden);
        };
        update();
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);

    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setIsSubmitting(true);
        setError('');
        try {
            await login(email, password);
            audio.current?.play('success');
            navigate(from, { replace: true });
        } catch (err: any) {
            audio.current?.play('error');
            setError(err.message || 'An error occurred during login.');
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    };

    const isMotionPaused = motionPaused || reducedMotion;
    const motionLabel = reducedMotion ? 'Animation disabled by system preference' : isMotionPaused ? 'Play background animation' : 'Pause background animation';

    return (
        <div className="zeaplay-login" ref={pageRoot} data-motion-paused={isMotionPaused}>
            <AnimatedLoginBackground reducedMotion={reducedMotion} />
            <header className="login-topbar">
                <div className="login-wordmark"><span className="login-brand-icon"><Gamepad2 size={22} aria-hidden="true" /></span>Zea.Play</div>
                <div className="login-topbar-actions">
                    <span className="login-version">V6.0.1</span>
                    <button type="button" className="login-motion-button login-sound-button" onClick={() => void toggleSound()}
                        aria-label={soundEnabled ? 'Mute interaction sound' : 'Enable interaction sound'}
                        title={soundEnabled ? 'Mute interaction sound' : 'Enable interaction sound'} aria-pressed={soundEnabled}>
                        {soundEnabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
                    </button>
                    <button type="button" className="login-motion-button" onClick={() => setMotionPaused(value => !value)}
                        disabled={reducedMotion} aria-label={motionLabel} title={motionLabel} aria-pressed={isMotionPaused}>
                        {isMotionPaused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
                    </button>
                </div>
                <span className="login-sr-only" role="status">{soundNotice}</span>
            </header>
            <main className="login-main">
                <section className="login-panel" aria-labelledby="login-title" data-error={!!error}>
                    <div className="login-console-surface" aria-hidden="true"><span className="login-console-grid" /></div>
                    <LoginConsoleEffects />
                    <div className="login-panel-heading">
                        <p className="login-eyebrow"><Sparkles size={14} aria-hidden="true" /> Your next level starts here</p>
                        <h1 id="login-title" aria-label="Zea.Play">Zea<span>.</span>Play</h1>
                        <p className="login-welcome">Welcome back, player.</p>
                    </div>
                    <form onSubmit={handleSubmit} className="login-form" aria-busy={isSubmitting}>
                        <div className="login-field">
                            <label htmlFor="email-address">Email address</label>
                            <div className="login-input-wrap">
                                <Mail size={18} className="login-input-icon" aria-hidden="true" />
                                <input id="email-address" name="email" type="email" autoComplete="email" required
                                    value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                                    aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                            </div>
                        </div>
                        <div className="login-field">
                            <div className="login-password-label">
                                <label htmlFor="password">Password</label>
                                <button ref={recoveryButton} type="button" onClick={() => { setRecoveryRequested(true); setForgotPasswordOpen(true); }} className="login-forgot">Forgot your password?</button>
                            </div>
                            <div className="login-input-wrap login-password-wrap">
                                <LockKeyhole size={18} className="login-input-icon" aria-hidden="true" />
                                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                                    value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"
                                    aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="login-visibility"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} aria-controls="password" aria-pressed={showPassword}>
                                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                        <div className="login-feedback">{error && <p id="login-error" role="alert">{error}</p>}</div>
                        <button type="submit" disabled={isSubmitting} className="login-submit" onClick={event => {
                            audio.current?.play('press');
                            if (isMotionPaused) return;
                            // Alternate CSS animation names without measuring layout or JS animation objects.
                            const button = event.currentTarget;
                            button.dataset.ripple = button.dataset.ripple === 'a' ? 'b' : 'a';
                        }}>
                            <span className="login-button-bubbles" aria-hidden="true"><i /><i /><i /><i /></span>
                            <span className="login-button-particles" aria-hidden="true"><i /><i /><i /></span>
                            <span className="login-button-ripple" aria-hidden="true" />
                            <span>{isSubmitting ? 'Signing in...' : 'Sign in'}</span>
                            {isSubmitting ? <LoaderCircle className="login-spinner" size={19} aria-hidden="true" /> : <ArrowRight size={19} aria-hidden="true" />}
                        </button>
                    </form>
                    <p className="login-card-signoff">A fresh start. A new high score.</p>
                </section>
                <div className="login-scene-caption" aria-hidden="true"><span>THE EVERYDAY ADVENTURE</span><p>Good work.<br />Great rewards.</p></div>
            </main>
            <footer className="login-footer"><span>Work meets play.</span><span>Zea.Play V6.0.1</span></footer>
            {recoveryRequested && <Suspense fallback={<span role="status" className="login-sr-only">Loading password recovery...</span>}>
                <ForgotPasswordModal isOpen={isForgotPasswordOpen} onClose={() => setForgotPasswordOpen(false)} />
            </Suspense>}
        </div>
    );
};

export default Login;
