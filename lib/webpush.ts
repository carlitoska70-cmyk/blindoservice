// Web Push from the Worker with WebCrypto only: VAPID (RFC 8292) and aes128gcm payload encryption
// (RFC 8291). Used to tell the owner's phone that an inspector has arrived, and for deadlines.
// Self-contained (no imports) so the Node tests can load it directly.

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };
export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url?: string; tag?: string };

const enc = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string) => {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(t, c => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) out.set(p, (i += p.length) - p.length);
  return out;
};

/** A new VAPID key pair: the public key goes to the browser, the private one stays in the database. */
export async function newVapidKeys(): Promise<VapidKeys> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return {
    publicKey: b64u(await crypto.subtle.exportKey('raw', k.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey),
  };
}

/** VAPID authorization header for one push service (audience = its origin), valid 12 hours. */
export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    keys.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

type Bytes = Uint8Array<ArrayBuffer>;
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  );
}

/** aes128gcm body for one subscription (RFC 8291), a single record. */
export async function encryptPayload(
  sub: Subscription,
  payload: PushPayload,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) {
  const uaPublic = unb64u(sub.p256dh),
    auth = unb64u(sub.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256),
  );
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Sends one notification. `gone` = the subscription no longer exists and should be dropped. */
export async function sendPush(
  sub: Subscription,
  payload: PushPayload,
  keys: VapidKeys,
  subject: string,
  fetchImpl: typeof fetch = fetch,
) {
  const body = await encryptPayload(sub, payload);
  const r = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
}
