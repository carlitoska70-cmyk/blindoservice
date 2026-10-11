// WebAuthn passkeys for the owner, verified with WebCrypto only (ES256 / P-256).
// Registration requires an existing owner session; login creates the same session
// as the password, bound to the current credential configuration.
import type { Database } from './admin-auth';

export const CHALLENGE_SECONDS = 5 * 60;
const ES256 = -7;

export const b64url = {
  encode(bytes: ArrayBuffer | Uint8Array) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (const x of u) s += String.fromCharCode(x);
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  },
  decode(text: string): Bytes {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 8192)
      throw new Error('PASSKEY_FORMAT');
    const s = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  },
};
type Bytes = Uint8Array<ArrayBuffer>;
const sha256 = async (data: Bytes | string) =>
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data),
  );
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Issues a single-use challenge; only its hash is stored. */
export async function issueChallenge(db: Database, kind: 'register' | 'login') {
  const challenge = b64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('DELETE FROM admin_challenges WHERE expires<=?').bind(nowSeconds()).run();
  await db
    .prepare('INSERT INTO admin_challenges(id,kind,expires) VALUES(?,?,?)')
    .bind(b64url.encode(await sha256(challenge)), kind, nowSeconds() + CHALLENGE_SECONDS)
    .run();
  return challenge;
}
/** Consumes a challenge: valid once, for its kind, before expiry. */
async function consumeChallenge(db: Database, kind: string, challenge: string) {
  const id = b64url.encode(await sha256(challenge));
  const row = await db
    .prepare('DELETE FROM admin_challenges WHERE id=? AND kind=? AND expires>? RETURNING id')
    .bind(id, kind, nowSeconds())
    .first<{ id: string }>();
  return !!row;
}

type ClientData = { type: string; challenge: string; origin: string; crossOrigin?: boolean };
async function checkClientData(
  db: Database,
  raw: Bytes,
  type: 'webauthn.create' | 'webauthn.get',
  origin: string,
) {
  let data: ClientData;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('PASSKEY_FORMAT');
  }
  if (data.type !== type || data.origin !== origin || data.crossOrigin) throw new Error('PASSKEY_CONTEXT');
  if (!(await consumeChallenge(db, type === 'webauthn.create' ? 'register' : 'login', data.challenge)))
    throw new Error('PASSKEY_CHALLENGE');
}

/** authenticatorData: rpIdHash(32) | flags(1) | signCount(4) | ... */
async function checkAuthData(auth: Bytes, rpId: string) {
  if (auth.length < 37) throw new Error('PASSKEY_FORMAT');
  if (!same(auth.slice(0, 32), await sha256(rpId))) throw new Error('PASSKEY_RP');
  const flags = auth[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('PASSKEY_USER'); // presence + verification
  return new DataView(auth.buffer, auth.byteOffset + 33, 4).getUint32(0);
}

/** WebAuthn ECDSA signatures are DER; WebCrypto expects raw r||s (64 bytes for P-256). */
export function derToRaw(der: Bytes): Bytes {
  let i = 0;
  const take = () => {
    if (der[i++] !== 0x02) throw new Error('PASSKEY_SIGNATURE');
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('PASSKEY_SIGNATURE');
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  if (der[i++] !== 0x30) throw new Error('PASSKEY_SIGNATURE');
  i++; // sequence length (short form for P-256)
  const r = take(),
    s = take();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

export type RegisterInput = {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string; // SPKI from AuthenticatorAttestationResponse.getPublicKey()
  publicKeyAlgorithm: number;
  label?: string;
};
export async function registerPasskey(
  db: Database,
  owner: string,
  input: RegisterInput,
  origin: string,
  rpId: string,
) {
  if (input.publicKeyAlgorithm !== ES256) throw new Error('PASSKEY_ALGORITHM');
  const id = b64url.encode(b64url.decode(input.id));
  if (!id || id.length > 1400) throw new Error('PASSKEY_FORMAT');
  await checkClientData(db, b64url.decode(input.clientDataJSON), 'webauthn.create', origin);
  const counter = await checkAuthData(b64url.decode(input.authenticatorData), rpId);
  const spki = b64url.decode(input.publicKey);
  // Rejects anything that is not a valid P-256 public key.
  await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const label = (input.label || 'Passkey').trim().slice(0, 60) || 'Passkey';
  await db
    .prepare('INSERT INTO admin_passkeys(id,owner,public_key,sign_count,label,created) VALUES(?,?,?,?,?,?)')
    .bind(id, owner, b64url.encode(spki), counter, label, new Date().toISOString())
    .run();
  return { id, label };
}

export type LoginInput = {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
};
/** Verifies an assertion and returns the passkey owner. */
export async function verifyPasskey(db: Database, input: LoginInput, origin: string, rpId: string) {
  const id = b64url.encode(b64url.decode(input.id));
  const row = await db
    .prepare('SELECT owner,public_key,sign_count FROM admin_passkeys WHERE id=?')
    .bind(id)
    .first<{ owner: string; public_key: string; sign_count: number }>();
  const clientData = b64url.decode(input.clientDataJSON);
  // The challenge is consumed even for unknown credentials, so it cannot be replayed.
  await checkClientData(db, clientData, 'webauthn.get', origin);
  if (!row) throw new Error('PASSKEY_UNKNOWN');
  const auth = b64url.decode(input.authenticatorData);
  const counter = await checkAuthData(auth, rpId);
  const key = await crypto.subtle.importKey(
    'spki',
    b64url.decode(row.public_key),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signed = new Uint8Array(auth.length + 32);
  signed.set(auth);
  signed.set(await sha256(clientData), auth.length);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    derToRaw(b64url.decode(input.signature)),
    signed,
  );
  if (!ok) throw new Error('PASSKEY_SIGNATURE');
  // Authenticators that count must move forward; a repeat suggests a cloned key.
  if ((counter || row.sign_count) && counter <= row.sign_count) throw new Error('PASSKEY_COUNTER');
  await db
    .prepare('UPDATE admin_passkeys SET sign_count=?,last_used=? WHERE id=?')
    .bind(counter, new Date().toISOString(), id)
    .run();
  return row.owner;
}
