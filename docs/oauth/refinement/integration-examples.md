# OAuth integration examples

Use your deployment's canonical HTTPS issuer, exact registered callback and
client ID. Discover endpoints at
`https://api.example.com/.well-known/oauth-authorization-server/api/oauth2`.
Validate the returned `issuer` against your configured issuer; never accept an
issuer supplied by an untrusted callback. Local loopback HTTP is development only.
These are OAuth API delegation examples, not OpenID Connect login examples.

## Public browser client: code + PKCE S256

Register a **public** client with callback
`https://client.example.com/oauth-callback.html`, authorization_code,
refresh_token, profile:read and offline_access. The client has no secret.
Run this script on `https://client.example.com` from a sign-in button's click
handler. Serve both pages with a restrictive CSP and Referrer-Policy: no-referrer.
All credentials below remain in closures, with no localStorage/sessionStorage,
URL token parameters, analytics or console logging.

```javascript
const issuer = 'https://api.example.com/api/oauth2';
const clientId = 'REPLACE_WITH_REGISTERED_PUBLIC_CLIENT_ID';
const redirectUri = 'https://client.example.com/oauth-callback.html';
let accessToken;
let refreshToken;
const b64 = bytes => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const random = size => b64(crypto.getRandomValues(new Uint8Array(size)));

async function tokenRequest(form) {
  const response = await fetch(issuer + '/token', {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  if (!response.ok) throw new Error('OAuth token exchange failed');
  const tokens = await response.json();
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
}

async function authorize() {
  // Open synchronously inside the click gesture to avoid popup blocking.
  const popup = window.open('about:blank', 'zea-oauth', 'width=600,height=800');
  if (!popup) throw new Error('Allow this authorization popup');
  const state = random(32);
  const verifier = random(48);
  const challenge = b64(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(verifier))));
  const code = await new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer); window.removeEventListener('message', onMessage);
      popup.close(); error ? reject(error) : resolve(value);
    };
    const onMessage = event => {
      if (event.source !== popup || event.origin !== new URL(redirectUri).origin) return;
      const result = event.data;
      if (!result || result.type !== 'zea-oauth-callback') return;
      if (result.state !== state || result.iss !== issuer)
        return finish(new Error('Authorization response did not match this request'));
      if (result.error || !result.code) return finish(new Error('Authorization denied or invalid'));
      finish(null, result.code);
    };
    const timer = setTimeout(() => finish(new Error('Authorization timed out')), 300000);
    window.addEventListener('message', onMessage);
    popup.location.href = issuer + '/authorize?' + new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
      scope: 'profile:read offline_access', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
  });
  await tokenRequest({ grant_type: 'authorization_code', client_id: clientId,
    redirect_uri: redirectUri, code, code_verifier: verifier });
}

async function profile() {
  const response = await fetch(issuer + '/profile', {
    credentials: 'omit', headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) throw new Error('Profile access denied');
  return response.json();
}

// Call refresh from one serialized request queue. Never retry an old refresh
// token after a lost/ambiguous response: reuse revokes the entire grant family.
async function refresh() {
  if (!refreshToken) throw new Error('Authorize again');
  const previous = refreshToken;
  refreshToken = undefined;
  accessToken = undefined;
  await tokenRequest({ grant_type: 'refresh_token', client_id: clientId,
    refresh_token: previous });
}

async function revoke() {
  const token = refreshToken || accessToken;
  refreshToken = accessToken = undefined;
  if (!token) return;
  const response = await fetch(issuer + '/revoke', {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, token }),
  });
  if (!response.ok) throw new Error('Server revocation failed; revoke in Zea.Play applications');
}
```

The callback page contains no third-party scripts. Its script is:

```javascript
const result = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname); // Remove code before other work.
if (window.opener) {
  window.opener.postMessage({ type: 'zea-oauth-callback',
    code: result.get('code'), state: result.get('state'), iss: result.get('iss'),
    error: result.get('error') }, 'https://client.example.com');
}
```

Keep a compatible popup opener policy; `Cross-Origin-Opener-Policy: same-origin`
on the client can sever a cross-origin authorization popup. Review CSP and opener
headers for your integration. A full-page redirect alternative must retain the
PKCE verifier/state in a backend session or other reviewed transaction mechanism.

Only GET profile, projects, project detail, tasks and task detail are delegated.
Register/request the corresponding read scopes; current user/tenant/resource
permissions still apply. Browser requests omit cookies. Management endpoints are
first-party administration endpoints and do not accept these scoped OAuth tokens.

## Confidential server client

Use the same authorization request and per-transaction PKCE/state/issuer checks.
Store the verifier/state in a server session tied to the initiating browser.
The HTTPS callback validates them before exchanging the code. It must use the
exact registered callback, including its query string if one was registered.
Never place the secret in a browser, callback URL, command-line argument or log.

The following exchange is runnable with `httpx` and environment values supplied
privately by your secret/session system. It intentionally prints no tokens.

```python
import os
from urllib.parse import quote_plus
import httpx

issuer = 'https://api.example.com/api/oauth2'
auth = (quote_plus(os.environ['OAUTH_CLIENT_ID']),
        quote_plus(os.environ['OAUTH_CLIENT_SECRET']))
with httpx.Client(timeout=15, follow_redirects=False) as client:
    response = client.post(issuer + '/token', auth=auth, data={
        'grant_type': 'authorization_code',
        'code': os.environ['OAUTH_CALLBACK_CODE'],
        'redirect_uri': 'https://server-client.example.com/oauth/callback',
        'code_verifier': os.environ['OAUTH_TRANSACTION_VERIFIER'],
    })
    if response.status_code != 200:
        raise RuntimeError('OAuth exchange failed')
    tokens = response.json()
    # Store tokens in the backend secret store/session, never in logs or a
    # browser cookie. Atomically replace refresh tokens on every refresh.
    profile = client.get(issuer + '/profile', headers={
        'Authorization': 'Bearer ' + tokens['access_token']})
    if profile.status_code != 200:
        raise RuntimeError('Profile access denied')
```

For refresh or revocation, authenticate with the same Basic credentials and
send form-body grant_type=refresh_token plus refresh_token, or token to /revoke.
Do not combine Basic with body client_secret. Rotate via management: the old
secret, pending consents and all existing grants are invalid immediately.

## Machine client

Register a confidential client with client_credentials and service:read only.
Use the preceding Python auth/client setup and replace the exchange with:

```python
response = client.post(issuer + '/token', auth=auth,
    data={'grant_type': 'client_credentials', 'scope': 'service:read'})
if response.status_code != 200:
    raise RuntimeError('Machine authorization failed')
tokens = response.json()
assert 'refresh_token' not in tokens
identity = client.get(issuer + '/service', headers={
    'Authorization': 'Bearer ' + tokens['access_token']})
if identity.status_code != 200:
    raise RuntimeError('Machine identity access denied')
```

This token cannot read tenant business data or impersonate a user. Tokens are
opaque; do not decode them as JWTs. Access lasts at most 600 seconds. Refresh
tokens rotate, last at most seven days and share a 30-day absolute grant lifetime.
Use the returned expires_in, since remaining grant lifetime can shorten it.
Respect 429 Retry-After. Do not automatically retry an exchange whose response
was lost: authorize again rather than replaying a potentially consumed credential.

The automated browser harness exercises real PKCE/consent/refresh/revocation and
a separate HTTP client origin. This illustrative deployment-domain code still
requires integration testing with your own callback and production headers.
