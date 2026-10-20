/** Helpers for controlled OAuth clients: callers retain these values in memory/server session. */
export async function createPkce() {
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const verifier = b64(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, state, challenge, method: 'S256' as const };
}

export function validateAuthorizationCallback(url: string, expectedState: string, expectedIssuer: string) {
  const params = new URL(url).searchParams;
  if (!expectedState || params.getAll('state').length !== 1 || params.get('state') !== expectedState) throw new Error('Invalid OAuth state');
  if (params.getAll('iss').length !== 1 || params.get('iss') !== expectedIssuer) throw new Error('Invalid OAuth issuer');
  if (params.has('error')) throw new Error('OAuth authorization denied');
  if (params.getAll('code').length !== 1 || !params.get('code')) throw new Error('Missing OAuth code');
  return params.get('code')!;
}
