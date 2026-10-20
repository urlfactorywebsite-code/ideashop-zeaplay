import React from 'react';
import { API_BASE_URL } from '../services/mockApi';

export default function OAuthDocumentation() {
  const base = API_BASE_URL;
  return <article className="oa-docs">
    <h3>Connect an application to Zea.Play</h3>
    <p>OAuth delegates API access with consent and revocable grants. It does not connect Google/Microsoft accounts or SMTP. Register an application, select the minimum scopes and copy its client ID. Public browser/native clients have no secret. Confidential backend clients keep their secret on the server.</p>
    <h3>Callbacks and consent</h3><p>Register exact HTTPS callbacks. HTTP is allowed only for localhost, 127.0.0.1 or ::1. No wildcards or fragments. The user must belong to the same tenant and explicitly allow the request. Application identities are not verified.</p>
    <h3>Authorization Code + PKCE (S256 required for all clients)</h3>
    <p>Generate a random verifier (43–128 characters), its SHA-256 base64url challenge and an unpredictable state. Keep them in memory or a secure server session. Navigate to the authorization URL, then verify the returned state and issuer before exchanging the one-use code. Codes expire in two minutes.</p>
    <pre>{`GET ${base}/oauth2/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=REGISTERED_CALLBACK&scope=profile%3Aread&state=RANDOM_STATE&code_challenge=S256_CHALLENGE&code_challenge_method=S256`}</pre>
    <pre>{`curl -X POST '${base}/oauth2/token' \\
  --data-urlencode 'grant_type=authorization_code' \\
  --data-urlencode 'client_id=CLIENT_ID' \\
  --data-urlencode 'code=RETURNED_CODE' \\
  --data-urlencode 'redirect_uri=REGISTERED_CALLBACK' \\
  --data-urlencode 'code_verifier=ORIGINAL_VERIFIER'
# Confidential clients also authenticate with HTTP Basic.
# Response: {"access_token":"...","token_type":"Bearer","expires_in":600,"scope":"profile:read"}`}</pre>
    <h3>Browser JavaScript / TypeScript</h3>
    <pre>{`const bytes = crypto.getRandomValues(new Uint8Array(48));
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const verifier = b64(bytes);
const state = b64(crypto.getRandomValues(new Uint8Array(32)));
const challenge = b64(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(verifier))));
// Keep state/verifier in memory (popup flow) or a secure backend session.
// On callback, reject missing/mismatched state and incorrect issuer FIRST.
const token = await fetch('${base}/oauth2/token', {
  method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({grant_type: 'authorization_code', client_id,
    code, redirect_uri, code_verifier: verifier})
}).then(r => r.json());
// Keep access tokens in memory. Privileged browser apps should use a BFF
// with HttpOnly Secure cookies; never put tokens in localStorage.`}</pre>
    <h3>Client Credentials (backend only)</h3>
    <p>Confidential machine clients may request service:read only. This tenant-bound service principal can read its own identity at /oauth2/service. It has no user role or access to tasks, projects, SMTP or administrative actions. Machine tokens expire in ten minutes and have no refresh token.</p>
    <pre>{`curl -u "$CLIENT_ID:$CLIENT_SECRET" '${base}/oauth2/token' \\
  -d 'grant_type=client_credentials&scope=service:read'
curl -H "Authorization: Bearer $ACCESS_TOKEN" '${base}/oauth2/service'`}</pre>
    <h3>Python (confidential backend)</h3><pre>{`import os, requests
base = '${base}'
auth = (os.environ['CLIENT_ID'], os.environ['CLIENT_SECRET'])
r = requests.post(base + '/oauth2/token', auth=auth,
    data={'grant_type': 'client_credentials', 'scope': 'service:read'}, timeout=10)
r.raise_for_status()
access = r.json()['access_token']
identity = requests.get(base + '/oauth2/service',
    headers={'Authorization': 'Bearer ' + access}, timeout=10)
identity.raise_for_status()`}</pre>
    <h3>Scopes and API access</h3><p>profile:read → GET /oauth2/profile. projects:read → GET /projects and /projects/{'{id}'}. tasks:read → GET /tasks and /tasks/{'{id}'}. Existing roles, membership and tenant access still apply. No write scopes are available. service:read is for machines only.</p>
    <h3>Refresh and revoke</h3><p>Register refresh_token and offline_access together, and request offline_access during consent. Refresh tokens expire after seven days; grants have a thirty-day absolute lifetime. Replace the refresh token after every exchange. Reusing a spent refresh token revokes the entire grant. Never retry a refresh blindly after an uncertain network response; restart authorization.</p>
    <pre>{`POST ${base}/oauth2/token
Content-Type: application/x-www-form-urlencoded
grant_type=refresh_token&client_id=CLIENT_ID&refresh_token=CURRENT_REFRESH

POST ${base}/oauth2/revoke
Content-Type: application/x-www-form-urlencoded
client_id=CLIENT_ID&token=ACCESS_OR_REFRESH
# Confidential clients must also authenticate. Revokes the entire grant.

POST ${base}/oauth2/introspect
Authorization: Basic BASE64_CLIENT_CREDENTIALS
Content-Type: application/x-www-form-urlencoded
token=ACCESS_OR_REFRESH
# Only a confidential client may introspect its own tokens.`}</pre>
    <h3>Lifecycle and operations</h3><p>Client secrets expire after ninety days. Rotation reveals the new secret once and invalidates every existing grant. Editing, disabling or archiving a client revokes all grants; re-enabling never restores old grants. Users can revoke access under Authorized applications. Tokens are opaque; there is no JWKS or OpenID Connect ID token. Discovery is available at /.well-known/oauth-authorization-server/api/oauth2 when the issuer ends with /api/oauth2.</p>
    <h3>Errors and security</h3><p>invalid_client: check type, status, secret and expiry. invalid_grant: expired, replayed, revoked or incorrectly bound code/refresh token, or PKCE mismatch. invalid_scope: select only registered and supported scopes. access_denied: user cancelled consent. 403: scope or existing access policy denies the request. 429: wait before retrying. Never log tokens or include client secrets in URLs.</p>
    <p>Bearer Key Builder credentials are existing user JWTs, separate from OAuth clients and grants. Their scope labels do not establish OAuth consent or immediate grant revocation. Do not substitute them for OAuth access tokens.</p>
  </article>;
}
