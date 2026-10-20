import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { OAuthGrant, oauthApi, oauthError } from '../services/oauthApi';
import { oauthDate } from '../components/OAuthManagement';
import '../components/OAuthManagement.css';

export default function OAuthApplications() {
  const { user, isCurrentSession } = useAuth();
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setGrants([]);
    void oauthApi.grants(true).then(rows => { if (!cancelled && isCurrentSession()) setGrants(rows); })
      .catch(e => { if (!cancelled) setError(oauthError(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, user?.tenantId, isCurrentSession]);
  return <section className="oauth-panel"><h2>Authorized applications</h2><p>Review applications you have allowed to access Zea.Play. Revoking a grant stops its access and refresh tokens immediately.</p>
    {error && <p role="alert" className="oa-message oa-error">{error}</p>}{loading && <p role="status">Loading authorized applications…</p>}
    {!loading && !grants.length && <p className="oa-empty">You have not authorized any applications.</p>}
    {grants.map(g => <article className="oa-card" key={g.id}><h3>{g.client_name}</h3><p>{g.scopes.join(', ')}</p><small>Tenant {g.tenant_id}<br />Authorized {oauthDate(g.created_at)} · Expires {oauthDate(g.expires_at)}<br />Last used {oauthDate(g.last_used_at)}</small><p>{g.revoked_at ? 'Revoked' : g.active ? 'Active' : 'Expired / inactive'}</p>
      <button className="oa-danger" disabled={!!g.revoked_at || !!busy} onClick={() => {
        if (!window.confirm(`Revoke ${g.client_name}'s access?`)) return;
        setBusy(g.id); setError('');
        void oauthApi.revoke(g.id).then(() => oauthApi.grants(true)).then(rows => { if (isCurrentSession()) setGrants(rows); }).catch(e => setError(oauthError(e))).finally(() => setBusy(''));
      }}>{busy === g.id ? 'Revoking…' : 'Revoke access'}</button></article>)}
  </section>;
}
