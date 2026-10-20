import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Consent, oauthApi, oauthError } from '../services/oauthApi';
import '../components/OAuthManagement.css';

export default function OAuthAuthorization() {
  const { user, loading, login, isCurrentSession } = useAuth();
  const location = useLocation();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    let cancelled = false;
    setConsent(null); setError('');
    if (!user) return;
    const params = Object.fromEntries(new URLSearchParams(location.search));
    void oauthApi.prepare(params).then(result => { if (!cancelled && isCurrentSession()) setConsent(result); })
      .catch(e => { if (!cancelled) setError(oauthError(e)); });
    return () => { cancelled = true; };
  }, [user?.id, user?.tenantId, location.search, isCurrentSession]);
  async function decide(allow: boolean) {
    if (!consent || busy) return;
    setBusy(true); setError('');
    try {
      const result = await oauthApi.consent(consent.ticket, allow);
      if (!isCurrentSession()) return;
      const callback = new URL(result.redirect_to);
      const registered = new URL(consent.redirect_uri);
      // Preserve the server's exact registered origin/path/query prefix.
      if (callback.origin !== registered.origin || callback.pathname !== registered.pathname) throw new Error('Invalid callback');
      window.location.assign(result.redirect_to);
    } catch (e) { setError(oauthError(e)); setBusy(false); }
  }
  return <main className="oauth-panel oa-consent" aria-busy={loading || busy}>
    <h2>Zea.Play · Application authorization</h2>
    {error && <p role="alert" className="oa-message oa-error">{error}</p>}
    {loading ? <p role="status">Checking your session…</p> : !user ? <>
      <p>Sign in to Zea.Play to review this application’s access request.</p>
      <form onSubmit={e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); void login(email, password).then(() => setPassword('')).catch(() => setError('Sign-in failed. Check your credentials.')).finally(() => setBusy(false)); }}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="oa-primary" disabled={busy}>Sign in and review</button>
      </form>
    </> : consent ? <>
      <h3>{consent.application} requests access</h3><p>{consent.description}</p>
      <p className="oa-message oa-warning">This application’s identity has not been independently verified. Continue only if you trust it.</p>
      <p>Signed in as {user.name}. Tenant: <code>{consent.tenant_id}</code></p>
      <h3>Requested permissions</h3><ul>{consent.scopes.map(s => <li className={s.sensitive ? 'oa-message oa-warning' : 'oa-message'} key={s.id}><b>{s.id}{s.sensitive ? ' · Sensitive' : ''}</b><p>{s.description}</p></li>)}</ul>
      <p>Callback: <code>{consent.redirect_uri}</code></p><p>Access stays within your existing role and tenant. You can revoke it at any time.</p>
      <div className="oa-actions"><button autoFocus disabled={busy} onClick={() => void decide(false)}>Cancel</button><button className="oa-primary" disabled={busy} onClick={() => void decide(true)}>Allow access</button></div>
    </> : !error ? <p role="status">Loading the authorization request…</p> : <p>Restart authorization from the requesting application.</p>}
    <p><Link to="/oauth/applications">Manage authorized applications</Link></p>
  </main>;
}
