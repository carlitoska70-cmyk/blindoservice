import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_BYTES,
  collectHolding,
  holdingSummary,
  holdingTarget,
  sendHolding,
  HOLDING_URL,
} from '../lib/holding.ts';

const now = new Date('2026-10-22T10:00:00Z'); // 22/10 in Italy
const meta = { version: '0.2.0', release: { id: 'v1', timestamp: '2026-10-22T09:00:00Z' }, now };
const doc = (title, expires, extra = {}) => ({ kind: 'document', data: { title, expires, ...extra } });
const inspection = (data, created = '2026-10-01T08:00:00Z') => ({
  kind: 'inspection',
  created,
  data: {
    authority: 'ASP Palermo',
    scope: 'Verifica HACCP',
    officers: 'Ispettore Mario Rossi, targa AB123CD',
    reference: 'Prot. 4471/2026',
    status: 'concluso',
    outcome: 'Esito scritto a mano con il nome del funzionario Rossi',
    started: '2026-10-01T08:00:00Z',
    ended: '2026-10-01T09:30:00Z',
    ...data,
  },
});
const summary = (records, extra = {}) =>
  holdingSummary({ ...meta, owner: true, records, portalEnabled: true, ...extra });

test('documenti: scaduti, entro 30 giorni, archiviati e senza data', () => {
  const s = summary([
    doc('SCIA', '2026-11-21'), // 30 days
    doc('Agibilità', '2026-11-22'), // 31 days: out of the window
    doc('HACCP', '2026-10-22'), // today
    doc('Certificato prevenzione incendi', '2026-10-01'),
    doc('Vecchio', '2026-09-01', { archivedAt: '2026-09-02T00:00:00Z' }),
    doc('Senza data', ''),
  ]);
  assert.equal(s.stato, 'attenzione');
  assert.deepEqual(s.dati.documenti, { attivi: 5, scaduti: 1, in_scadenza: 2, entro_giorni: 30 });
  assert.deepEqual(s.dati.documenti_scaduti, [
    { titolo: 'Certificato prevenzione incendi', scaduto_il: '2026-10-01', da_giorni: 21 },
  ]);
  assert.deepEqual(s.dati.documenti_in_scadenza, [
    { titolo: 'HACCP', scade_il: '2026-10-22', tra_giorni: 0 },
    { titolo: 'SCIA', scade_il: '2026-11-21', tra_giorni: 30 },
  ]);
  assert.equal(
    s.testo,
    '1 documento scaduto · 2 in scadenza entro 30 giorni · nessun controllo aperto · portale QR attivo',
  );
  assert.equal(s.dati.riepilogo.testo, s.testo);
  assert.equal(s.dati.versione, '0.2.0');
  assert.equal(s.dati.rilascio, '2026-10-22T09:00:00Z');
  assert.equal(s.dati.oggi, '2026-10-22');
  assert.equal(s.dati.elenchi_completi, true);
});

test('controlli: aperti e recenti, mai i dati dei controllori', () => {
  const s = summary([
    inspection({ status: 'aperto', started: '2026-10-22T08:15:00Z', ended: '' }),
    inspection({}),
    inspection({ started: '2026-05-02T08:00:00Z', ended: '2026-05-02T09:00:00Z' }), // 173 days ago
    inspection({ status: 'aperto', archivedAt: '2026-10-20T00:00:00Z' }),
  ]);
  assert.equal(s.stato, 'attenzione');
  assert.deepEqual(s.dati.controlli, { aperti: 1, recenti: 1, recenti_giorni: 90, ultimo_il: '2026-10-22' });
  assert.deepEqual(s.dati.controlli_elenco, [
    {
      ente: 'ASP Palermo',
      oggetto: 'Verifica HACCP',
      stato: 'aperto',
      iniziato_il: '2026-10-22',
      concluso_il: null,
    },
    {
      ente: 'ASP Palermo',
      oggetto: 'Verifica HACCP',
      stato: 'concluso',
      iniziato_il: '2026-10-01',
      concluso_il: '2026-10-01',
    },
  ]);
  const json = JSON.stringify(s);
  for (const secret of ['Rossi', 'AB123CD', '4471', 'Esito', 'officers', 'outcome', 'reference'])
    assert.ok(!json.includes(secret), `non deve uscire: ${secret}`);
  assert.match(s.testo, /1 controllo aperto/);
});

test('tutto in ordine: stato ok e portale spento', () => {
  const s = summary([doc('SCIA', '2027-03-01'), inspection({})], { portalEnabled: false });
  assert.equal(s.stato, 'ok');
  assert.equal(
    s.testo,
    'nessun documento scaduto · nessuna scadenza entro 30 giorni · nessun controllo aperto · portale QR spento',
  );
  assert.deepEqual(s.dati.portale_qr, { attivo: false });
});

test('nessun titolare configurato', () => {
  const s = holdingSummary({ ...meta, owner: false, records: [], portalEnabled: false });
  assert.equal(s.stato, 'attenzione');
  assert.equal(s.testo, 'Nessun titolare configurato in Blindo Service');
});

test('sotto i 16 KB anche con centinaia di documenti; i conteggi restano esatti', () => {
  const long = 'Autorizzazione sanitaria è più lunga del previsto — ' + 'àèìòù€'.repeat(40);
  const records = [];
  for (let i = 0; i < 300; i++) records.push(doc(`${long} ${i}`, i % 2 ? '2026-10-01' : '2026-11-01'));
  for (let i = 0; i < 40; i++) records.push(inspection({ status: 'aperto', scope: long }));
  const s = summary(records);
  assert.ok(new TextEncoder().encode(JSON.stringify(s.dati)).length <= MAX_BYTES);
  assert.ok(JSON.stringify(s.dati).length <= 16_384);
  assert.equal(s.dati.documenti.scaduti, 150);
  assert.equal(s.dati.documenti.in_scadenza, 150);
  assert.equal(s.dati.controlli.aperti, 40);
  assert.equal(s.dati.elenchi_completi, false);
  assert.ok(s.dati.documenti_scaduti.length >= 1);
  assert.ok(s.dati.documenti_scaduti[0].titolo.length <= 120);
});

test('indirizzo: solo HTTPS, oppure HTTP in locale', () => {
  assert.equal(holdingTarget(), HOLDING_URL);
  assert.equal(holdingTarget('https://esempio.it/x'), 'https://esempio.it/x');
  assert.equal(
    holdingTarget('http://127.0.0.1:8790/api/holding/segnale'),
    'http://127.0.0.1:8790/api/holding/segnale',
  );
  assert.equal(holdingTarget('http://esempio.it/x'), null);
  assert.equal(holdingTarget('non è un indirizzo'), null);
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE admin_identity(slot INTEGER PRIMARY KEY, owner TEXT);' +
      'CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,data TEXT,created TEXT,updated TEXT);' +
      'CREATE TABLE portals(id TEXT PRIMARY KEY,owner TEXT,enabled INTEGER,created TEXT);',
  );
  const add = (id, owner, r) =>
    sqlite
      .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
      .run(id, owner, r.kind, JSON.stringify(r.data), r.created || '2026-10-01T00:00:00Z', '');
  const db = {
    prepare(query) {
      let params = [];
      return {
        bind(...v) {
          params = v;
          return this;
        },
        async first() {
          return sqlite.prepare(query).get(...params) || null;
        },
        async all() {
          return { results: sqlite.prepare(query).all(...params) };
        },
      };
    },
  };
  return { sqlite, add, db };
}

test('dal database: solo l’archivio del titolare di questa copia', async () => {
  const { sqlite, add, db } = fixture();
  assert.equal((await collectHolding(db, meta)).testo, 'Nessun titolare configurato in Blindo Service');
  sqlite.exec("INSERT INTO admin_identity VALUES(1,'carlo');INSERT INTO portals VALUES('p1','carlo',1,'')");
  add('d1', 'carlo', doc('SCIA del Kassaro', '2026-11-01'));
  add('d2', 'altro', doc('Documento di un altro esercente', '2026-10-01'));
  add('i1', 'altro', inspection({ status: 'aperto' }));
  add('t1', 'carlo', { kind: 'task', data: { title: 'Azione', due: '2026-10-01', done: false } });
  const s = await collectHolding(db, meta);
  assert.equal(s.stato, 'ok');
  assert.deepEqual(s.dati.documenti, { attivi: 1, scaduti: 0, in_scadenza: 1, entro_giorni: 30 });
  assert.equal(s.dati.controlli.aperti, 0);
  assert.deepEqual(s.dati.portale_qr, { attivo: true });
  assert.ok(!JSON.stringify(s).includes('altro esercente'));
});

test('invio: chiave, formato e nessun errore che fermi Blindo', async () => {
  const { sqlite, add, db } = fixture();
  sqlite.exec("INSERT INTO admin_identity VALUES(1,'carlo')");
  add('d1', 'carlo', doc('SCIA', '2026-10-01'));
  const key = 'kosw_' + 'x'.repeat(43);
  const calls = [];
  const ok = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  };

  assert.deepEqual(await sendHolding({ DB: db }, meta, ok), {
    sent: false,
    reason: 'Chiave della holding non configurata',
  });
  assert.equal(calls.length, 0);

  const r = await sendHolding({ DB: db, HOLDING_SEGNALE_KEY: key }, meta, ok);
  assert.deepEqual(r, { sent: true, status: 200, stato: 'attenzione' });
  assert.equal(calls[0].url, HOLDING_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body), ['stato', 'testo', 'dati']);
  assert.equal(body.dati.documenti.scaduti, 1);
  assert.ok(!calls[0].init.body.includes(key));

  const refused = async () => new Response('{"error":"Chiave non valida"}', { status: 401 });
  assert.deepEqual(await sendHolding({ DB: db, HOLDING_SEGNALE_KEY: key }, meta, refused), {
    sent: false,
    status: 401,
    reason: 'La centrale risponde 401',
  });
  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  assert.deepEqual(await sendHolding({ DB: db, HOLDING_SEGNALE_KEY: key }, meta, offline), {
    sent: false,
    reason: 'Centrale non raggiungibile',
  });
  const slow = async () => {
    throw new DOMException('timeout', 'TimeoutError');
  };
  assert.equal(
    (await sendHolding({ DB: db, HOLDING_SEGNALE_KEY: key }, meta, slow)).reason,
    'La centrale non risponde',
  );
  assert.equal(
    (await sendHolding({ DB: db, HOLDING_SEGNALE_KEY: key, HOLDING_URL: 'http://esempio.it' }, meta, ok))
      .reason,
    'Indirizzo della holding non valido',
  );

  // Archive unreadable: the centrale still hears from Blindo, with stato errore.
  const broken = {
    prepare() {
      throw new Error('no such table: admin_identity');
    },
  };
  calls.length = 0;
  assert.equal((await sendHolding({ DB: broken, HOLDING_SEGNALE_KEY: key }, meta, ok)).stato, 'errore');
  assert.equal(JSON.parse(calls[0].init.body).testo, 'Archivio non leggibile');
});
