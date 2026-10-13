import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useTheme } from '../hooks/useAuth';
import Ballpit from '../components/Ballpit';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import LoginDocumentationModal from '../components/LoginDocumentationModal';
import { CodeBracketSquareIcon, EyeIcon, EyeSlashIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, QuestionMarkCircleIcon } from '../components/icons';

type ThemeMode = 'light' | 'dark' | 'colorful' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful';

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
    if (theme === 'colorful') return 'colorful';
    if (theme === 'light') return 'light';
    if (theme === 'dark') return 'dark';
    if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
};

const useResolvedTheme = (theme: ThemeMode): ResolvedTheme => {
    const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));

    useEffect(() => {
        if (theme === 'system') {
            const media = window.matchMedia('(prefers-color-scheme: dark)');
            const listener = () => setResolved(media.matches ? 'dark' : 'light');
            listener();
            media.addEventListener('change', listener);
            return () => media.removeEventListener('change', listener);
        }
        setResolved(resolveTheme(theme));
    }, [theme]);

    return resolved;
};

const HERO_ART = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg width="420" height="340" viewBox="0 0 420 340" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.9" />
                <stop offset="50%" stop-color="#c084fc" stop-opacity="0.85" />
                <stop offset="100%" stop-color="#f472b6" stop-opacity="0.8" />
            </linearGradient>
            <radialGradient id="glow" cx="50%" cy="50%" r="75%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
                <stop offset="100%" stop-color="#3b0764" stop-opacity="0" />
            </radialGradient>
        </defs>
        <rect width="420" height="340" rx="32" fill="#0f172a" />
        <circle cx="210" cy="170" r="150" fill="url(#glow)" />
        <path d="M55 210 C90 120 160 120 200 210 S320 300 365 210" stroke="url(#grad)" stroke-width="14" fill="none" stroke-linecap="round"/>
        <path d="M85 160 C120 90 210 90 250 180" stroke="url(#grad)" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="14 18"/>
        <path d="M200 250 L240 140 L320 200 Z" fill="url(#grad)" opacity="0.75" />
        <circle cx="120" cy="240" r="18" fill="#38bdf8" opacity="0.65" />
        <circle cx="300" cy="130" r="14" fill="#f472b6" opacity="0.75" />
        <circle cx="340" cy="260" r="10" fill="#c084fc" opacity="0.7" />
    </svg>
`)} `;

const featureChecklist = [
    {
        icon: <SparklesIcon className="h-4 w-4" />,
        title: 'Unlock daily quests',
        description: 'Earn XP and rewards for every sprint you conquer.'
    },
    {
        icon: <RocketLaunchIcon className="h-4 w-4" />,
        title: 'Power up teamwork',
        description: 'Instant visibility on blockers, streaks, and wins.'
    },
    {
        icon: <TrophyIcon className="h-4 w-4" />,
        title: 'Climb the leaderboard',
        description: 'Collect badges and flex your ship-ready status.'
    }
];

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isForgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const [isDocOpen, setIsDocOpen] = useState(false);

    const { login } = useAuth();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';

    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';

    const backgroundGradient = useMemo(() => {
        if (isDark) {
            return 'radial-gradient(circle at 20% 20%, rgba(56,189,248,0.25), transparent 45%), radial-gradient(circle at 80% 10%, rgba(192,132,252,0.2), transparent 40%), radial-gradient(circle at 50% 80%, rgba(244,114,182,0.18), transparent 45%), linear-gradient(135deg, #0f172a 0%, #111827 45%, #1f2937 100%)';
        }
        if (isColorful) {
            return 'radial-gradient(circle at 10% 15%, rgba(244,114,182,0.35), transparent 40%), radial-gradient(circle at 80% 20%, rgba(129,140,248,0.35), transparent 45%), radial-gradient(circle at 50% 85%, rgba(56,189,248,0.3), transparent 40%), linear-gradient(135deg, #eef2ff 0%, #fdf2f8 50%, #ecfeff 100%)';
        }
        return 'radial-gradient(circle at 15% 20%, rgba(79,70,229,0.25), transparent 40%), radial-gradient(circle at 85% 25%, rgba(167,139,250,0.2), transparent 45%), radial-gradient(circle at 50% 85%, rgba(14,165,233,0.25), transparent 40%), linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 50%, #fdf2f8 100%)';
    }, [isDark, isColorful]);

    const cardSurface = isDark
        ? 'bg-slate-950/75 border-white/10 text-white'
        : isColorful
            ? 'bg-white/85 border-white/60 text-slate-900 shadow-[0_30px_60px_rgba(129,140,248,0.25)]'
            : 'bg-white/90 border-slate-200 text-slate-900 shadow-2xl';

    const inputSurface = isDark
        ? 'bg-white/5 border-white/15 text-white placeholder-white/40'
        : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400';

    const heroBadgeText = isDark ? 'text-white/70' : 'text-slate-500';
    const heroTitleClass = isDark ? 'text-white' : 'text-slate-900';
    const heroBodyClass = isDark ? 'text-white/80' : 'text-slate-600';
    const featureCardSurface = isDark
        ? 'border-white/15 bg-white/10 text-white/80 hover:border-white/40 hover:bg-white/15'
        : isColorful
            ? 'border-white/60 bg-white/80 text-slate-700 hover:border-indigo-200 hover:bg-white'
            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50';
    const featureTitleClass = isDark ? 'text-white' : 'text-slate-900';
    const featureBodyClass = isDark ? 'text-white/70' : 'text-slate-600';

    const formTitleClass = isDark ? 'text-white' : 'text-slate-900';
    const formSubtitleClass = isDark ? 'text-white/70' : 'text-slate-600';
    const tipTextClass = isDark ? 'text-white/60' : 'text-slate-500';
    const linkClass = isDark ? 'text-sky-300 hover:text-sky-200' : 'text-indigo-500 hover:text-indigo-400';
    const errorClasses = isDark
        ? 'border-red-400/40 bg-red-500/10 text-red-200'
        : 'border-red-400/60 bg-red-100 text-red-700';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        try {
            await login(email, password);
            navigate(from, { replace: true });
        } catch (err: any) {
            setError(err.message || 'An error occurred during login.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="relative min-h-screen overflow-hidden"
            style={{ backgroundImage: backgroundGradient }}
        >
            <style>
                {`
                    @keyframes auroraPulse {
                        0%, 100% { opacity: 0.6; transform: translate3d(0,0,0) scale(1); }
                        50% { opacity: 1; transform: translate3d(0,-12px,0) scale(1.05); }
                    }
                    @keyframes cardFloat {
                        0%, 100% { transform: translateY(0px); }
                        50% { transform: translateY(-10px); }
                    }
                    @keyframes shimmer {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                    }
                `}
            </style>

            <Ballpit
                className="pointer-events-none absolute inset-0 opacity-60"
                count={120}
                gravity={0.005}
                friction={0.998}
                wallBounce={0.95}
                followCursor={false}
            />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-32 -left-40 h-80 w-80 rounded-full bg-gradient-to-r from-sky-500/40 via-violet-500/40 to-rose-500/40 blur-3xl animate-[auroraPulse_16s_ease-in-out_infinite]" />
                <div className="absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-gradient-to-r from-emerald-400/30 via-sky-400/30 to-purple-400/35 blur-3xl animate-[auroraPulse_18s_ease-in-out_infinite]" style={{ animationDelay: '1.5s' }} />
            </div>

            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-10">
                <div className="grid w-full max-w-6xl gap-10 rounded-3xl border border-white/10 bg-white/5 px-8 py-10 shadow-[0_20px_70px_rgba(15,23,42,0.45)] backdrop-blur-2xl lg:grid-cols-[1.15fr,0.85fr]" style={{ animation: 'cardFloat 11s ease-in-out infinite' }}>
                    <div className="flex flex-col justify-between gap-8">
                        <div>
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${heroBadgeText} ${isDark ? 'border-white/20 bg-white/10' : 'border-indigo-200 bg-white/70 shadow-sm'}`}>
                                <SparklesIcon className="h-4 w-4" />
                                Zea.Play V1.2.1
                            </div>
                            <h1 className={`mt-5 text-4xl font-extrabold tracking-tight ${heroTitleClass}`}>
                                Gear up for your next sprint.
                            </h1>
                            <p className={`mt-3 max-w-xl text-sm ${heroBodyClass}`}>
                                Sign in to claim streak rewards, tackle quests, and sync with your squad. Every login pushes your mission forward.
                            </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            {featureChecklist.map((feature) => (
                                <div key={feature.title} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition-transform duration-200 hover:-translate-y-1 ${featureCardSurface}`}>
                                    <span className={`grid h-8 w-8 place-items-center rounded-full ${isDark ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-600 shadow-inner'}`}>
                                        {feature.icon}
                                    </span>
                                    <div>
                                        <p className={`text-sm font-semibold ${featureTitleClass}`}>{feature.title}</p>
                                        <p className={`text-xs ${featureBodyClass}`}>{feature.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className={`relative overflow-hidden rounded-3xl border px-8 py-10 shadow-[0_25px_55px_rgba(15,23,42,0.35)] backdrop-blur-xl ${cardSurface}`}>
                        <div className="absolute -top-32 -right-40 h-72 w-72 rounded-full bg-gradient-to-r from-sky-400/25 via-fuchsia-400/20 to-rose-400/25 blur-3xl" />
                        <div className="absolute -bottom-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
                        <img src={HERO_ART} alt="Mission control" className="pointer-events-none absolute -right-10 top-24 hidden h-56 w-72 opacity-70 md:block" />

                        <div className="relative space-y-8">
                            <div className="text-center space-y-2">
                                <div className={`flex items-center justify-center gap-2 ${formTitleClass}`}>
                                    <CodeBracketSquareIcon className="h-10 w-10 text-sky-300" />
                                    <h2 className="text-3xl font-bold">Zea.Play V1.2.1</h2>
                                </div>
                                <p className={`text-sm ${formSubtitleClass}`}>
                                    Welcome back, hero. Ready to launch today�s missions?
                                </p>
                            </div>

                            <form className="space-y-6" onSubmit={handleSubmit}>
                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="email-address" className="sr-only">Email address</label>
                                        <input
                                            id="email-address"
                                            name="email"
                                            type="email"
                                            autoComplete="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className={`w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition ${inputSurface}`}
                                            placeholder="Email address"
                                        />
                                    </div>
                                    <div className="relative">
                                        <label htmlFor="password" className="sr-only">Password</label>
                                        <input
                                            id="password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            autoComplete="current-password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className={`w-full rounded-xl border px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition ${inputSurface}`}
                                            placeholder="Password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className={`absolute inset-y-0 right-0 mr-3 flex items-center transition ${isDark ? 'text-white/60 hover:text-white' : 'text-slate-400 hover:text-slate-600'}`}
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? (
                                                <EyeSlashIcon className="h-5 w-5" />
                                            ) : (
                                                <EyeIcon className="h-5 w-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {error && (
                                    <div className={`rounded-xl border px-4 py-3 text-sm ${errorClasses}`}>
                                        {error}
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-sm">
                                    <button
                                        type="button"
                                        onClick={() => setForgotPasswordOpen(true)}
                                        className={`font-semibold transition ${linkClass}`}
                                    >
                                        Forgot your password?
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 via-fuchsia-400 to-rose-400 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                    <span className="absolute inset-0 rounded-xl bg-white/30 opacity-0 transition group-hover:opacity-60" style={{ mixBlendMode: 'overlay', animation: 'shimmer 4s ease-in-out infinite' }} />
                                    <span className="relative z-10">{isSubmitting ? 'Signing in...' : 'Sign in'}</span>
                                </button>
                            </form>

                            <p className={`text-center text-xs ${tipTextClass}`}>
                                Tip: Daily streak bonuses reset at midnight. Don�t miss yours!
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <ForgotPasswordModal
                isOpen={isForgotPasswordOpen}
                onClose={() => setForgotPasswordOpen(false)}
            />

            <LoginDocumentationModal
                isOpen={isDocOpen}
                onClose={() => setIsDocOpen(false)}
            />
        </div>
    );
};

export default Login;



