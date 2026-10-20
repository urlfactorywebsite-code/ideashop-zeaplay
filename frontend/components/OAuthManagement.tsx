import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ClientInput, Dashboard, OAuthClient, OAuthEvent, OAuthGrant, OAuthScope, OAuthToken, oauthApi, oauthError } from '../services/oauthApi';
import OAuthDocumentation from './OAuthDocumentation';
import './OAuthManagement.css';

export const oauthDate = (value: number | null) => value ? new Date(value * 1000).toLocaleString() : '—';
const blank = (): ClientInput => ({ name: '', description: '', category: 'integration', client_type: 'public', redirect_uris: [], grant_types: ['authorization_code'], scopes: ['profile:read'], enabled: true });
const configuration = (client: OAuthClient): ClientInput => ({ name: client.name, description: client.description, category: client.category, client_type: client.client_type, redirect_uris: client.redirect_uris, grant_types: client.grant_types, scopes: client.scopes, enabled: client.enabled, owner_id: client.owner_id });

function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className="oauth-panel oa-dialog" aria-labelledby="oa-dialog-title" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="oa-toolbar"><h2 id="oa-dialog-title">{title}</h2><button type="button" onClick={close} aria-label="Close dialog">Close</button></div>{children}
  </dialog>;
}

export default function OAuthManagement() {
  const { user, isCurrentSession } = useAuth();
  const allowed = !!user && ['admin', 'owner'].includes(user.role.toLowerCase());
  const [tab, setTab] = useState('Overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [scopes, setScopes] = useState<OAuthScope[]>([]);
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [tokens, setTokens] = useState<OAuthToken[]>([]);
  const [events, setEvents] = useState<OAuthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [edit, setEdit] = useState<OAuthClient | 'new' | null>(null);
  const [draft, setDraft] = useState<ClientInput>(blank);
  const [redirects, setRedirects] = useState('');
  const [credential, setCredential] = useState<{ client: OAuthClient; client_secret: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<unknown> } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await Promise.all([oauthApi.dashboard(), oauthApi.clients(search, status), oauthApi.scopes(), oauthApi.grants(), oauthApi.tokens(), oauthApi.events()]);
      if (id !== generation.current || !isCurrentSession()) return;
      setDashboard(result[0]); setClients(result[1]); setScopes(result[2]); setGrants(result[3]); setTokens(result[4]); setEvents(result[5]);
    } catch (e) { if (id === generation.current) setError(oauthError(e)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [isCurrentSession, search, status]);
  useEffect(() => { const timer = setTimeout(() => { if (allowed) void load(); }, 250); return () => { clearTimeout(timer); ++generation.current; }; }, [allowed, user?.id, user?.tenantId, load]);
  useEffect(() => { setCredential(null); setEdit(null); setConfirm(null); }, [user?.id, user?.tenantId]);
  async function action(task: () => Promise<unknown>) {
    if (actionLock.current || !isCurrentSession()) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); if (isCurrentSession()) { setConfirm(null); setNotice('OAuth configuration updated.'); await load(); } }
    catch (e) { if (isCurrentSession()) setError(oauthError(e)); }
    finally { actionLock.current = false; setBusy(false); }
  }
  function open(client: OAuthClient | 'new') {
    setEdit(client); setDraft(client === 'new' ? blank() : configuration(client));
    setRedirects(client === 'new' ? '' : client.redirect_uris.join('\n')); setError('');
  }
  const field = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => setDraft(d => ({ ...d, [key]: value }));
  const toggle = (key: 'grant_types' | 'scopes', value: string) => field(key, draft[key].includes(value) ? draft[key].filter(s => s !== value) : [...draft[key], value]);
  const filtered = clients.filter(c => (c.name + ' ' + c.client_id).toLowerCase().includes(search.toLowerCase()) && (status === 'all' || c.enabled === (status === 'enabled')));
  if (!allowed) return <section className="oauth-panel"><h2>OAuth management</h2><p role="alert">Owner or admin privileges are required.</p><Link to="/oauth/applications">Manage your authorized applications</Link></section>;
  return <section className="oauth-panel" aria-label="OAuth management" aria-busy={loading || busy}>
    <div className="oa-toolbar"><div><h2>OAuth management</h2><p>Control application access to your tenant.</p></div><div className="oa-actions"><Link to="/oauth/applications">My authorized applications</Link><button disabled={loading || busy} onClick={() => void load()}>Refresh</button><button className="oa-primary" disabled={busy} onClick={() => open('new')}>Register application</button></div></div>
    {error && <div role="alert" className="oa-message oa-error">{error}</div>}
    {notice && <p role="status" className="oa-message">{notice}</p>}
    {loading && <p role="status">Loading OAuth data…</p>}
    {dashboard && !dashboard.configured && <p className="oa-message oa-warning">OAuth issuance is disabled until the server issuer and consent URL are configured.</p>}
    <nav className="oa-tabs" aria-label="OAuth sections">{['Overview', 'OAuth Clients', 'Scopes and Permissions', 'Active Grants', 'Security and Audit Logs', 'Documentation'].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
    {tab === 'Overview' && dashboard && <>
      <p><small>Tenant: {dashboard.tenant_id}</small></p>
      <div className="oa-grid">{([['Total OAuth clients', dashboard.total_clients], ['Enabled clients', dashboard.enabled_clients], ['Disabled clients', dashboard.disabled_clients], ['Active grants', dashboard.active_grants], ['Revoked grants', dashboard.revoked_grants], ['Activity · last 7 days', dashboard.recent_activity]] as const).map(([label, count]) => <div className="oa-card" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      <h3>Token issuance and errors · UTC days</h3><div className="oa-scroll"><table className="oa-chart"><thead><tr><th>Day</th><th>Issued</th><th>Errors</th><th>Issuance trend</th></tr></thead><tbody>{dashboard.trends.map(t => <tr key={t.day}><td>{new Date(t.day * 1000).toISOString().slice(0, 10)}</td><td>{t.issued}</td><td>{t.errors}</td><td><div className="oa-trend" style={{ width: `${100 * t.issued / Math.max(1, ...dashboard.trends.map(r => r.issued))}%` }} /></td></tr>)}</tbody></table></div>
      <h3>Credentials expiring within 14 days</h3>{dashboard.expiring_credentials.length ? dashboard.expiring_credentials.map(c => <p className="oa-message oa-warning" key={c.id}>{c.name} · {oauthDate(c.secret_expires_at)}</p>) : <p>No credentials need rotation in the next 14 days.</p>}
      <h3>Client usage · retained grants</h3>{dashboard.usage.length ? <ul>{dashboard.usage.map((u, i) => <li key={i}>{u.client_name}: {u.grants}</li>)}</ul> : <p>No client usage yet.</p>}
      <h3>Recent authorization activity</h3>{events.slice(0, 6).map(e => <p key={e.id}><small>{oauthDate(e.created_at)}</small> · {e.action.replaceAll('_', ' ')}</p>)}{!events.length && <p>No OAuth activity yet.</p>}
    </>}
    {tab === 'OAuth Clients' && <>
      <div className="oa-toolbar"><label>Search applications<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or client ID" /></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label></div>
      {!filtered.length ? <p className="oa-empty">No matching applications. Register an application to begin.</p> : <div className="oa-scroll"><table><thead><tr><th>Application</th><th>Client / owner</th><th>Status</th><th>Scopes / grants</th><th>Actions</th></tr></thead><tbody>{filtered.map(c => <tr key={c.id}><td><b>{c.name}</b><p>{c.description}</p><small>{c.client_type} · {c.category}<br />Created {oauthDate(c.created_at)}<br />Updated {oauthDate(c.updated_at)}</small></td><td><code>{c.client_id}</code><p><small>Owner {c.owner_id}<br />Tenant {c.tenant_id}<br />Secret expires {oauthDate(c.secret_expires_at)}</small></p></td><td>{c.archived ? 'Archived' : c.enabled ? 'Enabled' : 'Disabled'}</td><td>{c.scopes.join(', ')}<p><small>{c.grant_types.join(', ')}</small></p></td><td><div className="oa-actions"><button disabled={busy || c.archived} onClick={() => open(c)}>Details / edit</button><button disabled={busy || c.archived} onClick={() => setConfirm({ title: c.enabled ? `Disable ${c.name} and revoke all grants?` : `Re-enable ${c.name}? Existing revoked grants stay revoked.`, action: () => c.enabled ? oauthApi.disable(c.id) : oauthApi.update(c.id, { ...configuration(c), enabled: true }) })}>{c.enabled ? 'Disable' : 'Re-enable'}</button>{c.client_type === 'confidential' && <button disabled={busy || c.archived} onClick={() => setConfirm({ title: `Rotate the secret for ${c.name} and revoke all grants?`, action: async () => { const result = await oauthApi.rotate(c.id); if (isCurrentSession()) setCredential(result); } })}>Rotate secret</button>}<button className="oa-danger" disabled={busy || c.archived} onClick={() => setConfirm({ title: `Archive ${c.name}? Credentials and grants will be revoked permanently.`, action: () => oauthApi.archive(c.id) })}>Archive</button></div></td></tr>)}</tbody></table></div>}
    </>}
    {tab === 'Scopes and Permissions' && <><h3>Available scopes</h3><p>Scopes restrict existing permissions. They cannot grant a stronger role, access to another tenant or access to unassigned resources.</p>{scopes.map(s => <div className="oa-card" key={s.id}><b>{s.id}</b>{s.sensitive && <span> · Sensitive permission</span>}<p>{s.description}</p></div>)}<p>Machine credentials support service:read only. Write APIs and other resource families are unavailable to OAuth clients.</p></>}
    {tab === 'Active Grants' && <><h3>Grants and authorized access</h3>{!grants.length ? <p className="oa-empty">No grants have been authorized.</p> : <div className="oa-scroll"><table><thead><tr><th>Client / grant</th><th>Owner / scopes</th><th>Lifecycle</th><th>Action</th></tr></thead><tbody>{grants.map(g => <tr key={g.id}><td>{g.client_name}<br /><code>{g.client_id}</code><br /><code>{g.id}</code></td><td>{g.user_id || 'Service principal'}<p>{g.scopes.join(', ')}</p><small>{g.tenant_id}</small></td><td>{g.revoked_at ? 'Revoked' : g.active ? 'Active' : 'Expired / inactive'}<p><small>Issued {oauthDate(g.created_at)}<br />Expires {oauthDate(g.expires_at)}<br />Last used {oauthDate(g.last_used_at)}</small></p></td><td><button disabled={busy || !!g.revoked_at} className="oa-danger" onClick={() => setConfirm({ title: `Revoke all access for ${g.client_name} under this grant?`, action: () => oauthApi.revoke(g.id) })}>Revoke grant</button></td></tr>)}</tbody></table></div>}
      <h3>Token metadata</h3><p>Raw access and refresh tokens are never available here.</p><div className="oa-scroll"><table><thead><tr><th>Token / grant</th><th>Type / scopes</th><th>Issued / expiry</th><th>Status</th></tr></thead><tbody>{tokens.map(t => { const grant = grants.find(g => g.id === t.grant_id); return <tr key={t.id}><td><code>{t.id}</code><br /><code>{t.grant_id}</code><p>{grant?.client_name}</p></td><td>{t.kind}<p>{t.scopes.join(', ')}</p></td><td>{oauthDate(t.created_at)}<br />{oauthDate(t.expires_at)}<br /><small>Last used {oauthDate(t.last_used_at)}</small></td><td>{t.revoked_at || grant?.revoked_at ? 'Revoked' : t.consumed_at ? 'Rotated / spent' : t.expires_at * 1000 <= Date.now() ? 'Expired' : grant?.active ? 'Active' : 'Inactive'}</td></tr>; })}</tbody></table></div>{!tokens.length && <p>No token metadata yet.</p>}
    </>}
    {tab === 'Security and Audit Logs' && <><h3>Recent security activity</h3><p>Latest 100 tenant events. No credentials are included.</p>{!events.length ? <p className="oa-empty">No events recorded.</p> : <div className="oa-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Client</th><th>Actor</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{oauthDate(e.created_at)}</td><td>{e.action.replaceAll('_', ' ')}</td><td>{clients.find(c => c.id === e.client_id)?.name || e.client_id}</td><td>{e.actor_id || 'Protocol / service'}</td></tr>)}</tbody></table></div>}</>}
    {tab === 'Documentation' && <OAuthDocumentation />}
    {edit && <Dialog title={edit === 'new' ? 'Register OAuth application' : 'Application configuration'} close={() => { if (!busy) setEdit(null); }}>
      <form onSubmit={e => { e.preventDefault(); void action(async () => { const payload = { ...draft, redirect_uris: redirects.split('\n').map(u => u.trim()).filter(Boolean) }; if (edit === 'new') { const result = await oauthApi.create(payload); if (isCurrentSession()) setCredential(result); } else await oauthApi.update(edit.id, payload); if (isCurrentSession()) setEdit(null); }); }}>
        <p>Editing an application revokes all its existing grants. New consent will be required.</p>{error && <p role="alert" className="oa-error">{error}</p>}
        <label>Application name<input required maxLength={150} value={draft.name} onChange={e => field('name', e.target.value)} autoFocus /></label>
        <label>Description<textarea maxLength={2000} value={draft.description} onChange={e => field('description', e.target.value)} /></label>
        <div className="oa-form-grid"><label>Client type<select aria-label="Client type" disabled={edit !== 'new'} value={draft.client_type} onChange={e => field('client_type', e.target.value as ClientInput['client_type'])}><option value="public">Public · browser / native</option><option value="confidential">Confidential · backend</option></select></label><label>Application category<input maxLength={80} value={draft.category} onChange={e => field('category', e.target.value)} /></label></div>
        <label>Owner user ID (your tenant only; defaults to you)<input maxLength={36} value={draft.owner_id || ''} onChange={e => field('owner_id', e.target.value || undefined)} /></label>
        <label>Registered redirect URIs · one per line<textarea value={redirects} onChange={e => setRedirects(e.target.value)} placeholder="https://app.example.com/callback" /></label><small>Exact HTTPS callbacks only; loopback HTTP is allowed for development.</small>
        <fieldset><legend>Allowed grant types</legend>{['authorization_code', 'refresh_token', 'client_credentials'].map(g => <label className="oa-check" key={g}><input type="checkbox" checked={draft.grant_types.includes(g)} onChange={() => toggle('grant_types', g)} />{g}</label>)}</fieldset>
        <fieldset><legend>Allowed scopes</legend>{scopes.map(s => <label className="oa-check" key={s.id}><input type="checkbox" checked={draft.scopes.includes(s.id)} onChange={() => toggle('scopes', s.id)} /><span><b>{s.id}</b> · {s.description}</span></label>)}</fieldset>
        <p><small>Enable offline_access with refresh_token. Machine grants require a confidential client and service:read.</small></p>
        <label className="oa-check"><input type="checkbox" checked={draft.enabled} onChange={e => field('enabled', e.target.checked)} />Enabled</label>
        <div className="oa-actions"><button className="oa-primary" disabled={busy} type="submit">{busy ? 'Saving…' : edit === 'new' ? 'Create application' : 'Save and revoke existing grants'}</button><button type="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</button></div>
      </form>
    </Dialog>}
    {confirm && <Dialog title="Confirm security action" close={() => { if (!busy) setConfirm(null); }}><p>{confirm.title}</p>{error && <p role="alert" className="oa-error">{error}</p>}<div className="oa-actions"><button autoFocus disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button className="oa-danger" disabled={busy} onClick={() => void action(confirm.action)}>Confirm</button></div></Dialog>}
    {credential && !edit && !confirm && <Dialog title="Application credentials" close={() => setCredential(null)}><p>Client ID</p><code className="oa-secret">{credential.client.client_id}</code>{credential.client_secret ? <><p className="oa-message oa-warning">Copy this secret now. It cannot be retrieved again. Store it only in your backend secret manager.</p><code className="oa-secret">{credential.client_secret}</code><button onClick={() => void navigator.clipboard.writeText(credential.client_secret!).then(() => setNotice('Secret copied.')).catch(() => setNotice('Clipboard unavailable. Select the secret to copy.'))}>Copy secret</button></> : <p>This public client has no client secret. Use Authorization Code with PKCE.</p>}<button onClick={() => setCredential(null)}>I have saved the credentials</button></Dialog>}
  </section>;
}
