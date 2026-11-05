import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import api from '../services/mockApi';
import type { SmtpProfile, SmtpProfileInput } from '../types/smtp';
import { applyPreset, blankProfile, mailCategories, profilePayload, providerPreset, profilePresetOptions } from '../utils/smtpProfiles';
import './SmtpManagement.css';

type Snapshot = Awaited<ReturnType<typeof api.getSmtpManagement>>;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not tested';
const providers = { custom: 'Custom SMTP', gmail: 'Gmail SMTP', outlook_com: 'Outlook.com SMTP', microsoft365: 'Microsoft 365 SMTP',
    zoho: 'Zoho SMTP', mailgun: 'Mailgun SMTP relay', sendgrid: 'SendGrid SMTP relay' };

export default function SmtpManagement() {
    const { user } = useAuth();
    const { notify } = useToast();
    const allowed = !!user && ['owner', 'admin'].includes(user.role.toLowerCase());
    const [data, setData] = useState<Snapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState('');
    const [hours, setHours] = useState(24);
    const [mode, setMode] = useState<'closed' | 'create' | 'edit'>('closed');
    const [editing, setEditing] = useState<SmtpProfile | null>(null);
    const [draft, setDraft] = useState(blankProfile);
    const [region, setRegion] = useState('com');
    const [business, setBusiness] = useState(false);
    const [busy, setBusy] = useState('');
    const [testTarget, setTestTarget] = useState<SmtpProfile | null>(null);
    const [recipient, setRecipient] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const touched = useRef(new Set<string>());
    const request = useRef<AbortController | null>(null);
    const actionLock = useRef(false);
    const mounted = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    const newButton = useRef<HTMLButtonElement>(null);
    const formWasOpen = useRef(false);

    const load = useCallback(async () => {
        if (!allowed) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        try {
            const snapshot = await api.getSmtpManagement(controller.signal, hours);
            if (!controller.signal.aborted) {
                setData(snapshot); setLoadError('');
                setSelected(previous => previous.filter(id => snapshot.jobs.some(job => job.id === id && job.can_retry)));
            }
        } catch (failure) {
            if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'SMTP data could not be loaded.');
        } finally { if (!controller.signal.aborted) setLoading(false); }
    }, [allowed, hours]);
    useEffect(() => {
        mounted.current = true;
        void load();
        const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
        return () => { mounted.current = false; request.current?.abort(); window.clearInterval(interval); };
    }, [load]);

    const action = async (key: string, operation: () => Promise<string>) => {
        if (actionLock.current) return;
        actionLock.current = true; setBusy(key); setError(''); setNotice('');
        try {
            const result = await operation();
            if (mounted.current) { setNotice(result); notify(result, 'success', 6000, 'above-navigation'); }
        } catch (failure) {
            if (mounted.current) {
                const message = failure instanceof Error ? failure.message : 'SMTP operation failed.';
                setError(message); notify(message, 'error', 8000, 'above-navigation');
            }
        } finally {
            actionLock.current = false;
            if (mounted.current) { setBusy(''); await load(); }
        }
    };
    const field = <K extends keyof SmtpProfileInput>(key: K, value: SmtpProfileInput[K]) => {
        touched.current.add(key); setDraft(previous => ({ ...previous, [key]: value }));
    };
    const openForm = (profile?: SmtpProfile) => {
        setEditing(profile || null); setMode(profile ? 'edit' : 'create'); setError(''); setNotice('');
        if (profile) {
            // Explicit allowlist: response metadata and saved secrets never enter the write payload.
            const empty = blankProfile();
            for (const key of Object.keys(empty)) if (key !== 'password' && key in profile) Object.assign(empty, { [key]: profile[key as keyof SmtpProfile] });
            setDraft(empty); touched.current = new Set(Object.keys(empty));
        } else { setDraft(blankProfile()); touched.current.clear(); }
        const preset = profile ? profilePresetOptions(profile) : { region: 'com', business: false };
        setRegion(preset.region); setBusiness(preset.business);
    };
    useEffect(() => {
        if (mode !== 'closed') formRef.current?.querySelector<HTMLInputElement>('[name="smtp-name"]')?.focus();
        else if (formWasOpen.current) newButton.current?.focus();
        formWasOpen.current = mode !== 'closed';
    }, [mode, editing?.id]);
    const chooseProvider = (value: SmtpProfileInput['provider']) => {
        setRegion('com'); setBusiness(false);
        setDraft(previous => ({ ...applyPreset(previous, providerPreset(value), touched.current), provider: value }));
    };
    const save = (event: React.FormEvent) => {
        event.preventDefault();
        void action('save', async () => {
            await api.saveSmtpProfile(editing?.id || null, profilePayload(draft));
            if (mounted.current) { setDraft(blankProfile()); setMode('closed'); setEditing(null); }
            return editing ? 'SMTP profile updated.' : 'SMTP profile created.';
        });
    };
    if (!allowed) return <section className="smtp-management"><p role="alert">SMTP Management requires a tenant Owner or Admin.</p></section>;

    return <section className="smtp-management" aria-labelledby="smtp-title" aria-busy={loading || !!busy}>
        <header className="smtp-heading"><div><p className="smtp-kicker">TRANSACTIONAL EMAIL</p><h2 id="smtp-title">SMTP Management</h2>
            <p>Tenant profiles, connection health, and durable email jobs.</p></div>
            <div className="smtp-actions"><button type="button" onClick={() => { setError(''); void load(); }} disabled={loading || !!busy}>Refresh</button>
                <button type="button" ref={newButton} className="smtp-primary" onClick={() => openForm()} disabled={!!busy}>New SMTP profile</button></div></header>
        {(error || loadError) && <p className="smtp-error" role="alert">{error || loadError}</p>}
        {notice && <p className="smtp-notice" role="status">{notice}</p>}
        {loading && !data && <div className="smtp-skeleton" role="status">Loading SMTP profiles, health and queue…</div>}
        {loading && data && <p className="smtp-muted">Refreshing SMTP data…</p>}
        {data && <>
            <div className="smtp-metrics">
                {[['SMTP profiles', data.health.profiles], ['Enabled profiles', data.health.enabled_profiles], ['Connection healthy', data.health.healthy_profiles],
                  ['Waiting jobs', data.health.queue.queued + data.health.queue.retrying]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
            </div>
            <p className="smtp-muted">Snapshot: {date(data.health.as_of)}. Refreshes every 30 seconds while visible. Connection tests are healthy for 15 minutes; delivery outcomes are separate.</p>
        </>}
        <div className={`smtp-columns ${mode === 'closed' ? 'smtp-form-closed' : ''}`}>
            {mode !== 'closed' && <form className="smtp-card smtp-profile-form" onSubmit={save} ref={formRef}>
                <h3>{mode === 'edit' ? `Edit SMTP Profile: ${editing?.name}` : 'Create SMTP Profile'}</h3>
                <div className="smtp-fields">
                    <label>Provider<select aria-label="Provider" value={draft.provider} onChange={event => chooseProvider(event.target.value as SmtpProfileInput['provider'])}>
                        {Object.entries(providers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Profile name<input name="smtp-name" required pattern=".*\S.*" maxLength={120} value={draft.name} onChange={event => field('name', event.target.value)} /></label>
                    {['zoho', 'mailgun', 'sendgrid'].includes(draft.provider) && <label>Provider region<select aria-label="Provider region" value={region} onChange={event => {
                        setRegion(event.target.value); setDraft(previous => applyPreset(previous, providerPreset(draft.provider, event.target.value, business), touched.current));
                    }}>{(draft.provider === 'zoho' ? [['com', 'US'], ['eu', 'Europe'], ['in', 'India'], ['com.au', 'Australia'], ['jp', 'Japan'], ['custom', 'Other: enter the account endpoint']] : [['com', 'US'], ['eu', 'Europe']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
                    {draft.provider === 'zoho' && <label className="smtp-check"><input type="checkbox" checked={business} onChange={event => {
                        setBusiness(event.target.checked); setDraft(previous => applyPreset(previous, providerPreset('zoho', region, event.target.checked), touched.current));
                    }} />Paid organization account (smtppro)</label>}
                    <label>SMTP host<input required maxLength={253} autoComplete="off" value={draft.host} onChange={event => field('host', event.target.value)} /></label>
                    <label>Port<input type="number" required min={1} max={65535} value={draft.port || ''} onChange={event => field('port', Number(event.target.value))} /></label>
                    <label>Security mode<select aria-label="Security mode" value={draft.encryption} onChange={event => field('encryption', event.target.value as SmtpProfileInput['encryption'])}>
                        <option value="tls">STARTTLS (usually 587)</option><option value="ssl">Implicit TLS (usually 465)</option><option value="none">Plaintext (server policy required)</option></select></label>
                    <label>Authentication<select aria-label="Authentication" value={draft.auth_method} onChange={event => { field('auth_method', event.target.value as SmtpProfileInput['auth_method']); if (event.target.value === 'oauth2') field('is_enabled', false); }}>
                        <option value="password">Password / app password</option><option value="oauth2">OAuth SMTP (not integrated)</option><option value="none">Approved unauthenticated relay</option></select></label>
                    <label>Username<input required maxLength={255} autoComplete="off" value={draft.username} onChange={event => field('username', event.target.value)} /></label>
                    <label>Password / app password<input type="password" maxLength={4096} autoComplete="new-password" value={draft.password || ''}
                        required={draft.auth_method === 'password' && draft.is_enabled && !editing?.has_password}
                        placeholder={editing?.has_password ? 'Leave blank to keep existing password' : 'Enter a new credential'} onChange={event => field('password', event.target.value)} /></label>
                    <label>Priority (lower is tried first)<input type="number" min={0} max={100000} required value={draft.priority} onChange={event => field('priority', Number(event.target.value))} /></label>
                    <label>Sender name<input maxLength={120} value={draft.sender_name || ''} onChange={event => field('sender_name', event.target.value)} /></label>
                    <label>Sender email<input type="email" required={draft.username === 'apikey'} value={draft.sender_email || ''} placeholder="Defaults to username when it is an email" onChange={event => field('sender_email', event.target.value)} /></label>
                    <label>Reply-to email<input type="email" value={draft.reply_to || ''} onChange={event => field('reply_to', event.target.value)} /></label>
                    <label>Attempt limit / minute<input type="number" required min={1} max={10000} value={draft.rate_limit_per_minute} onChange={event => field('rate_limit_per_minute', Number(event.target.value))} /></label>
                    <label>Daily attempt limit (UTC)<input type="number" required min={1} max={10000000} value={draft.daily_limit} onChange={event => field('daily_limit', Number(event.target.value))} /></label>
                </div>
                {draft.provider !== 'custom' && !(draft.provider === 'zoho' && region === 'custom') && <div className="smtp-preset"><button type="button" disabled={!!busy} onClick={() => {
                    const preset = providerPreset(draft.provider, region, business);
                    Object.keys(preset).forEach(key => touched.current.delete(key));
                    setDraft(previous => applyPreset(previous, preset, touched.current));
                }}>Apply selected provider defaults</button><p className="smtp-muted">This explicitly replaces transport/auth defaults; your password and sender identity stay in the form.</p></div>}
                {draft.auth_method === 'oauth2' && <p className="smtp-warning">SMTP OAuth token acquisition/refresh is not integrated. This profile must remain disabled. The OAuth tab does not provide SMTP mailbox authorization.</p>}
                {['outlook_com', 'microsoft365'].includes(draft.provider) && <p className="smtp-warning">Microsoft authentication policy depends on the service and account. SMTP OAuth is unavailable here; password mode requires explicit provider support. An approved relay is an alternative.</p>}
                {draft.provider === 'gmail' && <p className="smtp-muted">Use an app password when permitted by your Google account policy. A normal mailbox password is not a universal SMTP authentication method.</p>}
                <p className="smtp-muted">Presets preserve fields you edited. Confirm Zoho account endpoints in its server configuration. Mailgun and SendGrid use SMTP credentials here, not HTTP API delivery. Your sender must be authorized by your provider.</p>
                {editing?.has_password && <p className="smtp-muted">A stored credential exists. It is never returned to this form. A new value replaces it; a blank value preserves it.</p>}
                <fieldset><legend>Email categories</legend><div className="smtp-category-grid">{mailCategories.map(category => <label className="smtp-check" key={category.value}>
                    <input type="checkbox" checked={draft.notification_types.includes(category.value)} onChange={event => field('notification_types', event.target.checked ? [...draft.notification_types, category.value] : draft.notification_types.filter(value => value !== category.value))} />{category.label}</label>)}</div></fieldset>
                <label className="smtp-check"><input type="checkbox" checked={draft.is_enabled} disabled={draft.auth_method === 'oauth2'} onChange={event => field('is_enabled', event.target.checked)} />Enabled for routing</label>
                <p className="smtp-muted">OTP uses only profiles explicitly assigned to OTP. General fallback is restricted to this tenant.</p>
                <div className="smtp-actions"><button className="smtp-primary" type="submit" disabled={!!busy || draft.notification_types.length === 0}>{busy === 'save' ? 'Saving…' : 'Save profile'}</button>
                    <button type="button" disabled={!!busy} onClick={() => { setDraft(blankProfile()); setMode('closed'); setEditing(null); }}>Cancel editing</button></div>
            </form>}
            <div className="smtp-profile-list"><h3>Existing SMTP profiles</h3>
                {data && data.profiles.length === 0 && <div className="smtp-card"><p>No tenant-owned SMTP profiles yet.</p><p className="smtp-muted">Legacy global profiles require operator adoption before they become visible or eligible for routing.</p></div>}
                {data?.profiles.map(profile => {
                    const key = profile.id.startsWith('primary:') ? profile.id : `multi:${profile.id}`;
                    const stats = data.health.profile_stats[key];
                    return <article className="smtp-card" key={profile.id}>
                        <div className="smtp-card-heading"><div><h4>{profile.name}</h4><p className="smtp-muted">{profile.host}:{profile.port} · Priority {profile.priority}</p></div><span className={`smtp-badge smtp-${profile.health}`}>{profile.health}</span></div>
                        <p>{providers[profile.provider]} · {profile.encryption === 'tls' ? 'STARTTLS' : profile.encryption === 'ssl' ? 'Implicit TLS' : 'Plaintext'}</p>
                        <p className="smtp-muted">Categories: {profile.notification_types.map(value => mailCategories.find(category => category.value === value)?.label || value).join(', ')}</p>
                        <p className="smtp-muted">Connection test: {date(profile.last_test_at)}{profile.last_test_code ? ` · ${profile.last_test_code}` : ''}</p>
                        <p className="smtp-muted">Credential: {profile.has_password ? profile.secret_encrypted ? 'Encrypted / configured' : 'Legacy credential needs operator conversion' : 'Not configured'}</p>
                        {stats && <p className="smtp-profile-stats">{data.health.window_hours}h: Accepted {stats.smtp_accepted} · Failed attempts {stats.failed_attempts} · Success {stats.success_percentage === null ? '—' : `${stats.success_percentage}%`}</p>}
                        <div className="smtp-actions"><button type="button" onClick={() => openForm(profile)} disabled={!!busy}>Edit {profile.name}</button>
                            <button type="button" disabled={!!busy} onClick={() => void action('toggle', async () => { await api.saveSmtpProfile(profile.id, { is_enabled: !profile.is_enabled }); return profile.is_enabled ? 'Profile disabled.' : 'Profile enabled.'; })}>{profile.is_enabled ? 'Disable' : 'Enable'} {profile.name}</button>
                            <button type="button" disabled={!!busy} onClick={() => void action('connection', async () => (await api.testSmtpConnection(profile.id)).message)}>Test connection: {profile.name}</button>
                            <button type="button" disabled={!!busy} onClick={() => { setTestTarget(profile); setRecipient(''); setNotice(''); }}>Send test email: {profile.name}</button></div>
                    </article>;
                })}
            </div>
        </div>
        {testTarget && <form className="smtp-card smtp-test-form" onSubmit={event => { event.preventDefault(); void action('test-message', async () => {
            const result = await api.sendSmtpTestMessage(testTarget.id, recipient); if (mounted.current) { setTestTarget(null); setRecipient(''); } return result.message;
        }); }}><h3>Send test email: {testTarget.name}</h3><label>Explicit test recipient<input type="email" required autoComplete="off" value={recipient} onChange={event => setRecipient(event.target.value)} /></label>
            <p className="smtp-muted">Sends one real SMTP message after you press the button. SMTP acceptance does not confirm inbox delivery.</p>
            <div className="smtp-actions"><button type="submit" className="smtp-primary" disabled={!!busy}>Send one test message</button><button type="button" disabled={!!busy} onClick={() => setTestTarget(null)}>Cancel test</button></div></form>}
        {data && <>
            <section className="smtp-card"><div className="smtp-card-heading"><h3>Delivery analytics</h3><label>Time range<select aria-label="Time range" value={hours} onChange={event => setHours(Number(event.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></label></div>
                <p className="smtp-muted">Totals and profile statistics use the same selected UTC window and include explicit test messages.</p>
                {!!data.health.retired_profile_keys?.length && <p className="smtp-muted">Retired profiles in this window: {data.health.retired_profile_keys.length}. Accepted {data.health.retired_profile_keys.reduce((sum, key) => sum + data.health.profile_stats[key].smtp_accepted, 0)} · Failed attempts {data.health.retired_profile_keys.reduce((sum, key) => sum + data.health.profile_stats[key].failed_attempts, 0)}. These remain included in the totals.</p>}
                <div className="smtp-metrics">{[['SMTP accepted', data.health.smtp_accepted], ['Failed attempts', data.health.failed_attempts], ['Uncertain attempts', data.health.uncertain_attempts],
                    ['Acceptance success', data.health.success_percentage === null ? '—' : `${data.health.success_percentage}%`], ['Attempts / last minute', data.health.attempts_last_minute], ['Avg. processing', data.health.average_processing_ms === null ? '—' : `${data.health.average_processing_ms}ms`]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
                <details><summary>Metric definitions and routing policy</summary>{Object.entries(data.health.definitions).map(([name, text]) => <p key={name}><strong>{name.replaceAll('_', ' ')}:</strong> {text}</p>)}</details></section>
            <section className="smtp-card"><div className="smtp-card-heading"><div><h3>Email queue</h3><p className="smtp-muted">Latest 50 tenant jobs; current states across all time.</p></div>
                <button type="button" disabled={!!busy || selected.length === 0} onClick={() => void action('retry', async () => {
                    const result = await api.retrySmtpJobs(selected); setSelected([]); return `${result.selected} eligible jobs selected; ${result.skipped} skipped. Retry and quota limits remain in effect.`;
                })}>Retry {selected.length} eligible jobs</button></div>
                <p className="smtp-muted">Queued {data.health.queue.queued} · Sending {data.health.queue.sending} · Retrying {data.health.queue.retrying} · Permanently failed {data.health.queue.failed} · Uncertain {data.health.queue.uncertain}</p>
                <p className="smtp-warning">Uncertain acceptance and permanent failures are not automatically resent. Only due, retryable jobs below their attempt limit can be selected.</p>
                <div className="smtp-table-scroll"><table><thead><tr><th>Select</th><th>Category</th><th>State</th><th>Attempts</th><th>Next attempt</th></tr></thead><tbody>{data.jobs.map(job => <tr key={job.id}>
                    <td><label className="smtp-check"><input type="checkbox" aria-label={`Select job ${job.id}`} disabled={!job.can_retry || !!busy} checked={selected.includes(job.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, job.id] : previous.filter(id => id !== job.id))} /></label></td>
                    <td>{job.category}</td><td>{job.state}</td><td>{job.attempts}/{job.max_attempts}</td><td>{job.next_attempt_at ? date(job.next_attempt_at) : '—'}</td></tr>)}</tbody></table></div>
                {data.jobs.length === 0 && <p>No email jobs for this tenant.</p>}</section>
            <section className="smtp-card"><h3>SMTP attempt log</h3><p className="smtp-muted">Latest 50 tenant attempts. Connection tests are separate from message acceptance; retired profile history is retained. Message bodies and credentials are excluded.</p>
                <div className="smtp-table-scroll"><table><thead><tr><th>Time</th><th>Profile</th><th>Kind / category</th><th>Outcome</th><th>Result code</th></tr></thead><tbody>{data.attempts.map(attempt => <tr key={attempt.id}>
                    <td>{date(attempt.started_at)}</td><td>{data.profiles.find(profile => (profile.id.startsWith('primary:') ? profile.id : `multi:${profile.id}`) === attempt.profile_key)?.name || `${attempt.profile_key} (retired)`}</td>
                    <td>{attempt.kind} / {attempt.category}</td><td>{attempt.outcome}</td><td>{attempt.code || 'In progress'}</td></tr>)}</tbody></table></div>
                {data.attempts.length === 0 && <p>No connection or delivery attempts recorded.</p>}</section>
        </>}
    </section>;
}
