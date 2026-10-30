// What a merchant's copy needs: Web Push (encryption checked by decrypting as a browser does, VAPID
// signature verified), monthly AI cap, suspended subscription, technical report to the sales portal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { b64u, encryptPayload, newVapidKeys, sendPush, unb64u, vapidHeader } from '../lib/webpush.ts';
import { AiBudgetError, aiCap, aiSpent, estimate, meterFor } from '../lib/ai-budget.ts';
import { reportToPortal, suspensionBlock } from '../lib/copy.ts';
import { activationSql, copyConfig, names, newToken, sha256, slugOk } from './fabbrica.mjs';

const schema = readFileSync(new URL('./admin-login-schema.sql', import.meta.url), 'utf8');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  sqlite.exec(
    'CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,data TEXT,created TEXT,updated TEXT);' +
      'CREATE TABLE portals(id TEXT PRIMARY KEY,owner TEXT,enabled INTEGER,created TEXT);',
  );
  return {
    sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return stmt.get(...values) ?? null;
        },
        async all() {
          return { results: stmt.all(...values) };
        },
        async run() {
          return stmt.run(...values);
        },
      };
    },
  };
}

/** A browser's side of RFC 8291: decrypts what the push service delivers. */
function decrypt(body, ua, auth) {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16);
  assert.equal(b.readUInt32BE(16), 4096);
  const idlen = b[20];
  const asPublic = b.subarray(21, 21 + idlen);
  const cipher = b.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'delimitatore dell’ultimo record');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}
const phone = () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ua,
    auth,
    sub: { endpoint: 'https://push.example/x', p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) },
  };
};

test('notifica: il telefono decifra quello che Blindo cifra', async () => {
  const p = phone();
  const payload = {
    title: '🚨 Controllo in corso: ASP',
    body: 'Motivo dichiarato: HACCP. Àèìòù',
    url: '/',
    tag: 'blindo-controllo',
  };
  assert.deepEqual(decrypt(await encryptPayload(p.sub, payload), p.ua, p.auth), payload);
});

test('VAPID: firma valida per il servizio di notifiche, 12 ore', async () => {
  const keys = await newVapidKeys();
  const header = await vapidHeader(
    'https://web.push.apple.com/abc/def',
    keys,
    'https://blindo.test',
    1_800_000_000_000,
  );
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, s] = t.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://blindo.test');
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600);
  const pub = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);
  assert.ok(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(s), Buffer.from(`${h}.${c}`)),
  );
});

test('invio: intestazioni giuste; 410 vuol dire telefono sparito', async () => {
  const keys = await newVapidKeys();
  const p = phone();
  let seen;
  const r = await sendPush(
    p.sub,
    { title: 'x', body: 'y' },
    keys,
    'https://blindo.test',
    async (url, init) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(r.ok, true);
  assert.equal(seen.url, p.sub.endpoint);
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  assert.equal(
    (
      await sendPush(
        p.sub,
        { title: 'x', body: 'y' },
        keys,
        'https://b.test',
        async () => new Response(null, { status: 410 }),
      )
    ).gone,
    true,
  );
});

test('spesa IA: stima dai consumi; oltre il tetto si ferma fino al mese dopo', async () => {
  assert.equal(estimate({ model: 'gpt-4.1', usage: { input_tokens: 1_000_000, output_tokens: 0 } }), 2);
  assert.equal(
    estimate({ model: 'gpt-4.1-mini', usage: { input_tokens: 0, output_tokens: 1_000_000 } }),
    1.6,
  );
  assert.equal(estimate({ model: 'gpt-4o-transcribe', audioBytes: 240000 }), 0.006); // un minuto a 32 kbit/s
  assert.equal(estimate({ model: 'gpt-4.1', usage: {}, webSearch: true }), 0.03);
  assert.equal(aiCap({}), null);
  assert.equal(aiCap({ AI_TETTO_EURO: '10' }), 10);
  const db = database();
  let at = new Date('2026-10-30T10:00:00Z');
  const meter = meterFor({ DB: db, AI_TETTO_EURO: '1' }, () => at);
  await meter.before();
  await meter.after({ model: 'gpt-4.1', usage: { input_tokens: 400_000, output_tokens: 0 } });
  assert.deepEqual(await aiSpent(db, '2026-10'), { euro: 0.8, calls: 1 });
  await meter.before();
  await meter.after({ model: 'gpt-4.1', usage: { input_tokens: 100_000, output_tokens: 0 } });
  await assert.rejects(
    meter.before(),
    e => e instanceof AiBudgetError && /tetto mensile.*1,00 €/.test(e.message),
  );
  // Il mese dopo riparte.
  at = new Date('2026-11-01T10:00:00Z');
  await meter.before();
  // La copia di Carlo non ha tetto: conta ma non si ferma.
  const free = meterFor({ DB: db }, () => at);
  await free.after({ model: 'gpt-4.1', usage: { input_tokens: 90_000_000, output_tokens: 0 } });
  await free.before();
});

test('sospensione: sola lettura; portale, accesso e avvisi restano', () => {
  const env = { BLINDO_SOSPESO: '1' };
  const req = (path, method = 'POST') => new Request('https://b.test' + path, { method });
  assert.equal(suspensionBlock(req('/api/state'), {}), null, 'copia attiva: niente blocchi');
  assert.equal(suspensionBlock(req('/api/state'), env).status, 402);
  assert.equal(suspensionBlock(req('/api/live'), env).status, 402);
  assert.equal(suspensionBlock(req('/api/diagnostica'), env).status, 402);
  assert.equal(suspensionBlock(req('/api/state', 'GET'), env), null, 'si legge');
  assert.equal(suspensionBlock(req('/login', 'GET'), env), null);
  for (const p of ['/api/auth/login', '/api/auth/passkey', '/api/portal', '/api/portal/file', '/api/push'])
    assert.equal(suspensionBlock(req(p), env), null, p);
});

test('rapporto al portale: solo numeri e versione; senza configurazione non parte', async () => {
  const db = database();
  assert.equal((await reportToPortal({ DB: db }, '0.6.0')).sent, false);
  db.sqlite
    .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .run('d1', 'o', 'document', JSON.stringify({ title: 'SEGRETO SCIA', holder: 'Mario Rossi' }), '', '');
  db.sqlite
    .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .run('d2', 'o', 'document', JSON.stringify({ title: 'Archiviato', archivedAt: 'x' }), '', '');
  db.sqlite.prepare("INSERT INTO portals VALUES('p','o',1,'')").run();
  db.sqlite.prepare("INSERT INTO ai_usage VALUES('2026-10',1.234,7,'')").run();
  db.sqlite.prepare("INSERT INTO admin_credentials VALUES(1,'a@b.it','h','')").run();
  let seen;
  const r = await reportToPortal(
    {
      DB: db,
      PORTALE_URL: 'https://portale.test/',
      PORTALE_CHIAVE: 'k',
      BLINDO_COPIA: 'bar-rossi',
      AI_TETTO_EURO: '10',
    },
    '0.6.0',
    new Date('2026-10-30T10:00:00Z'),
    async (url, init) => {
      seen = { url, init };
      return new Response('{}', { status: 200 });
    },
  );
  assert.equal(r.sent, true);
  assert.equal(seen.url, 'https://portale.test/api/copie/segnale');
  assert.equal(seen.init.headers.Authorization, 'Bearer k');
  const b = JSON.parse(seen.init.body);
  assert.deepEqual(
    [b.copia, b.versione, b.attivata, b.sospesa, b.telefoni, b.documenti, b.portale_attivo],
    ['bar-rossi', '0.6.0', true, false, 0, 1, true],
  );
  assert.deepEqual(b.ia, { mese: '2026-10', euro: 1.23, chiamate: 7, tetto: 10 });
  assert.ok(!/SEGRETO|Rossi|a@b\.it/.test(seen.init.body), 'nessun contenuto e nessun nome');
  // HTTP in chiaro verso un altro host: non parte.
  assert.equal(
    (await reportToPortal({ DB: db, PORTALE_URL: 'http://portale.test/', PORTALE_CHIAVE: 'k' }, '0.6.0'))
      .sent,
    false,
  );
});

test('fabbrica: nomi, configurazione della copia senza segreti né holding, link che salva solo l’impronta', () => {
  for (const ok of ['bar-rossi', 'abc', 'caffe-2']) assert.ok(slugOk(ok), ok);
  for (const no of ['', 'ab', 'Bar', 'bar_rossi', '-bar', 'bar-', 'a'.repeat(31), '../x', undefined])
    assert.ok(!slugOk(no), String(no));
  assert.deepEqual(names('bar-rossi'), {
    worker: 'blindo-bar-rossi',
    database: 'blindo-bar-rossi',
    bucket: 'blindo-bar-rossi-documenti',
  });
  const c = copyConfig({
    slug: 'bar-rossi',
    databaseId: 'id-1',
    cap: 12,
    portal: 'https://portale.test',
    repo: '/repo',
  });
  assert.equal(c.name, 'blindo-bar-rossi');
  assert.equal(c.d1_databases[0].database_name, 'blindo-bar-rossi');
  assert.equal(c.r2_buckets[0].bucket_name, 'blindo-bar-rossi-documenti');
  assert.deepEqual(c.vars, {
    BLINDO_COPIA: 'bar-rossi',
    AI_TETTO_EURO: '12',
    PORTALE_URL: 'https://portale.test',
  });
  assert.deepEqual(c.triggers.crons, ['7 * * * *']);
  assert.ok(!JSON.stringify(c).includes('HOLDING'), 'la holding è solo di Carlo');
  assert.equal(
    copyConfig({ slug: 'bar-rossi', databaseId: 'x', cap: 5, suspended: true }).vars.BLINDO_SOSPESO,
    '1',
  );
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const sql = activationSql(token, 1000);
  assert.ok(!sql.includes(token), 'il link non finisce nel database');
  assert.ok(sql.includes(sha256(token)));
  assert.ok(sql.includes(String(1000 + 7 * 24 * 3600)));
});
