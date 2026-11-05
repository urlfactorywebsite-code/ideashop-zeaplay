import { http } from './mockApi';

export interface OAuthClient {
  id: string; client_id: string; tenant_id: string; owner_id: string; name: string;
  description: string; category: string; client_type: 'public' | 'confidential';
  redirect_uris: string[]; grant_types: string[]; scopes: string[]; enabled: boolean;
  archived: boolean; created_at: number; updated_at: number; secret_expires_at: number | null;
}
export type ClientInput = Pick<OAuthClient, 'name' | 'description' | 'category' | 'client_type' | 'redirect_uris' | 'grant_types' | 'scopes' | 'enabled'> & { owner_id?: string };
export interface OAuthScope { id: string; description: string; sensitive: boolean }
export interface OAuthGrant {
  id: string; client_id: string; client_name: string; tenant_id: string; user_id: string | null;
  scopes: string[]; created_at: number; expires_at: number; revoked_at: number | null;
  active: boolean; last_used_at: number | null;
}
export interface OAuthToken {
  id: string; kind: string; grant_id: string; scopes: string[]; created_at: number;
  expires_at: number; consumed_at: number | null; revoked_at: number | null; last_used_at: number | null;
}
export interface OAuthEvent { id: string; client_id: string; actor_id: string | null; action: string; created_at: number }
export interface Dashboard {
  configured: boolean; tenant_id: string; total_clients: number; enabled_clients: number; disabled_clients: number;
  active_grants: number; revoked_grants: number; recent_activity: number;
  trends: { day: number; issued: number; errors: number }[];
  expiring_credentials: OAuthClient[]; usage: { client_name: string; grants: number }[];
}
export interface Consent {
  ticket: string; application: string; description: string; tenant_id: string;
  redirect_uri: string; scopes: OAuthScope[]; verified: boolean;
}
const root = '/oauth2';
export const oauthApi = {
  clients: (q = '', status = 'all') => http.get<OAuthClient[]>(root + '/clients', { params: { q, status } }).then(r => r.data),
  dashboard: () => http.get<Dashboard>(root + '/dashboard').then(r => r.data),
  scopes: () => http.get<OAuthScope[]>(root + '/scopes').then(r => r.data),
  grants: (mine = false) => http.get<OAuthGrant[]>(root + (mine ? '/my-grants' : '/grants')).then(r => r.data),
  tokens: () => http.get<OAuthToken[]>(root + '/tokens').then(r => r.data),
  events: () => http.get<OAuthEvent[]>(root + '/events').then(r => r.data),
  create: (payload: ClientInput) => http.post<{ client: OAuthClient; client_secret: string | null }>(root + '/clients', payload).then(r => r.data),
  update: (id: string, payload: ClientInput) => http.patch<OAuthClient>(root + '/clients/' + id, payload).then(r => r.data),
  rotate: (id: string) => http.post<{ client: OAuthClient; client_secret: string }>(root + '/clients/' + id + '/rotate').then(r => r.data),
  disable: (id: string) => http.post(root + '/clients/' + id + '/revoke'),
  archive: (id: string) => http.delete(root + '/clients/' + id),
  revoke: (id: string) => http.post(root + '/grants/' + id + '/revoke'),
  prepare: (params: Record<string, string>) => http.post<Consent>(root + '/consent/prepare', params).then(r => r.data),
  consent: (ticket: string, allow: boolean) => http.post<{ redirect_to: string }>(root + '/consent', { ticket, allow }).then(r => r.data),
};
export function oauthError(error: any): string {
  const status = error?.response?.status;
  if (status === 404) return 'OAuth management API is unavailable. Deploy the matching backend and migration.';
  if (status === 403) return 'You do not have permission for this OAuth action.';
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map(item => String(item.msg || 'Invalid field')).join('; ');
  return typeof detail === 'string' ? detail : 'The OAuth request failed. Check the configuration and try again.';
}
