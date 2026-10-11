import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(tmpdir(), 'presidio-passkey-'));
const out = join(dir, 'passkey.mjs');
writeFileSync(
  out,
  ts.transpileModule(readFileSync('lib/passkey.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const { b64url, derToRaw, issueChallenge, registerPasskey, verifyPasskey } = await import(
  pathToFileURL(out).href
);
rmSync(dir, { recursive: true, force: true });

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('scripts/admin-login-schema.sql', 'utf8'));
class Statement {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.sql, args);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.args) || null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.args) };
  }
  async run() {
    return sqlite.prepare(this.sql).run(...this.args);
  }
}
const db = { prepare: sql => new Statement(sql) };

const origin = 'https://presidio.test',
  rpId = 'presidio.test';
const enc = new TextEncoder();
const sha = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

function rawToDer(raw) {
  const int = v => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    v = v.slice(i);
    if (v[0] & 0x80) v = Uint8Array.of(0, ...v);
    return Uint8Array.of(0x02, v.length, ...v);
  };
  const r = int(raw.slice(0, 32)),
    s = int(raw.slice(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const id = b64url.encode(crypto.getRandomValues(new Uint8Array(16)));
  const authData = async (counter, flags = 0x05, rp = rpId) => {
    const a = new Uint8Array(37);
    a.set(await sha(enc.encode(rp)));
    a[32] = flags;
    new DataView(a.buffer).setUint32(33, counter);
    return a;
  };
  const clientData = (type, challenge, o = origin) =>
    enc.encode(JSON.stringify({ type, challenge, origin: o }));
  return {
    id,
    async register(challenge, o) {
      return {
        id,
        clientDataJSON: b64url.encode(clientData('webauthn.create', challenge, o)),
        authenticatorData: b64url.encode(await authData(0)),
        publicKey: b64url.encode(spki),
        publicKeyAlgorithm: -7,
        label: 'iPhone',
      };
    },
    async assert(challenge, { counter = 1, flags = 0x05, tamper = false } = {}) {
      const cd = clientData('webauthn.get', challenge);
      const ad = await authData(counter, flags);
      const signed = new Uint8Array([...ad, ...(await sha(cd))]);
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed),
      );
      if (tamper) raw[5] ^= 1;
      return {
        id,
        clientDataJSON: b64url.encode(cd),
        authenticatorData: b64url.encode(ad),
        signature: b64url.encode(rawToDer(raw)),
      };
    },
  };
}

const rejects = (p, code) => assert.rejects(p, e => e.message === code);

test('DER signature conversion round trip', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(64));
  raw[0] = 0;
  raw[32] = 0x90;
  assert.deepEqual([...derToRaw(rawToDer(raw))], [...raw]);
});

test('registration: origin, challenge reuse, algorithm', async () => {
  const a = await authenticator();
  const bad = await issueChallenge(db, 'register');
  await rejects(
    registerPasskey(db, 'owner', await a.register(bad, 'https://evil.test'), origin, rpId),
    'PASSKEY_CONTEXT',
  );
  const loginChallenge = await issueChallenge(db, 'login');
  await rejects(
    registerPasskey(db, 'owner', await a.register(loginChallenge), origin, rpId),
    'PASSKEY_CHALLENGE',
  );
  const c = await issueChallenge(db, 'register');
  await rejects(
    registerPasskey(db, 'owner', { ...(await a.register(c)), publicKeyAlgorithm: -257 }, origin, rpId),
    'PASSKEY_ALGORITHM',
  );
  const ok = await registerPasskey(db, 'owner', await a.register(c), origin, rpId);
  assert.equal(ok.label, 'iPhone');
  await rejects(registerPasskey(db, 'owner', await a.register(c), origin, rpId), 'PASSKEY_CHALLENGE');
});

test('login: valid, replay, signature, user verification, counter, expiry', async () => {
  const a = await authenticator();
  await registerPasskey(db, 'owner', await a.register(await issueChallenge(db, 'register')), origin, rpId);
  const c1 = await issueChallenge(db, 'login');
  const first = await a.assert(c1, { counter: 5 });
  assert.equal(await verifyPasskey(db, first, origin, rpId), 'owner');
  await rejects(verifyPasskey(db, first, origin, rpId), 'PASSKEY_CHALLENGE');
  await rejects(
    verifyPasskey(
      db,
      await a.assert(await issueChallenge(db, 'login'), { counter: 6, tamper: true }),
      origin,
      rpId,
    ),
    'PASSKEY_SIGNATURE',
  );
  await rejects(
    verifyPasskey(
      db,
      await a.assert(await issueChallenge(db, 'login'), { counter: 7, flags: 0x01 }),
      origin,
      rpId,
    ),
    'PASSKEY_USER',
  );
  await rejects(
    verifyPasskey(db, await a.assert(await issueChallenge(db, 'login'), { counter: 5 }), origin, rpId),
    'PASSKEY_COUNTER',
  );
  assert.equal(
    await verifyPasskey(db, await a.assert(await issueChallenge(db, 'login'), { counter: 9 }), origin, rpId),
    'owner',
  );
  const late = await issueChallenge(db, 'login');
  sqlite.prepare('UPDATE admin_challenges SET expires=0').run();
  await rejects(verifyPasskey(db, await a.assert(late, { counter: 10 }), origin, rpId), 'PASSKEY_CHALLENGE');
  const stranger = await authenticator();
  await rejects(
    verifyPasskey(db, await stranger.assert(await issueChallenge(db, 'login')), origin, rpId),
    'PASSKEY_UNKNOWN',
  );
});
