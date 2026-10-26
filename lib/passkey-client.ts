'use client';
// Browser side of WebAuthn: converts between ArrayBuffers and base64url for the API.
const enc = (b: ArrayBuffer) => {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const dec = (t: string) =>
  Uint8Array.from(atob(t.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((t.length + 3) % 4)), c =>
    c.charCodeAt(0),
  );

async function call(body: unknown) {
  const r = await fetch('/api/auth/passkey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || 'Operazione non riuscita');
  return data;
}

export const passkeySupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

export async function loginWithPasskey() {
  const o = await call({ action: 'login-options' });
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: dec(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 120000 },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Accesso annullato');
  const res = cred.response as AuthenticatorAssertionResponse;
  await call({
    action: 'login',
    credential: {
      id: cred.id,
      clientDataJSON: enc(res.clientDataJSON),
      authenticatorData: enc(res.authenticatorData),
      signature: enc(res.signature),
    },
  });
}

export async function registerPasskey(label: string) {
  const o = await call({ action: 'register-options' });
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: dec(o.challenge),
      user: { ...o.user, id: dec(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((x: any) => ({ type: 'public-key', id: dec(x.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Registrazione annullata');
  const res = cred.response as AuthenticatorAttestationResponse;
  const publicKey = res.getPublicKey?.();
  if (!publicKey) throw new Error('Questo browser non supporta le passkey per Blindo Service.');
  return call({
    action: 'register',
    credential: {
      id: cred.id,
      clientDataJSON: enc(res.clientDataJSON),
      authenticatorData: enc(res.getAuthenticatorData()),
      publicKey: enc(publicKey),
      publicKeyAlgorithm: res.getPublicKeyAlgorithm(),
      label,
    },
  });
}

export const deletePasskey = (id: string) => call({ action: 'delete', id });
