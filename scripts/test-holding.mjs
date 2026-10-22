import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_BYTES,
  collectHolding,
  controlPage,
  evidenceLink,
  holdingSummary,
  holdingTarget,
  parseEvidence,
  profileGaps,
  runHolding,
  sendHolding,
  syncEvidence,
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
      'CREATE TABLE portals(id TEXT PRIMARY KEY,owner TEXT,enabled INTEGER,created TEXT);' +
      'CREATE TABLE profiles(owner TEXT PRIMARY KEY,data TEXT,updated TEXT);',
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
        async run() {
          return { meta: { changes: sqlite.prepare(query).run(...params).changes } };
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

const evidenceAnswer = {
  fonte: 'Kassaro OS',
  versione: '8.3.0',
  generato: '2026-10-22T09:59:00.000Z',
  base: 'https://kassaro-os.onrender.com',
  riepilogo: { presenti: 9, parziali: 9, assenti: 9 },
  voci: [
    {
      categoria: 'HACCP',
      catalogo: 'Manuale o piano di autocontrollo',
      stato: 'presente',
      dettaglio: 'Manuale HACCP, versione 3 salvata il 2026-10-20',
      ultimo: '2026-10-20',
      sezione: '/#/haccp',
    },
    {
      categoria: 'HACCP',
      catalogo: 'Monitoraggio infestanti',
      stato: 'assente',
      dettaglio: 'Nessun controllo infestanti registrato',
      sezione: '//altrove.example/x',
    },
    {
      categoria: 'Alimenti',
      catalogo: 'Schede ingredienti e allergeni',
      stato: 'parziale',
      dettaglio: '31 schede, 0 verificate',
      ultimo: 'ieri',
      sezione: 'javascript:alert(1)',
    },
    { catalogo: 'Voce senza stato', dettaglio: 'scartata' },
  ],
  pagina_controlli: {
    attiva: true,
    url: 'https://kassaro-os.onrender.com/controllo/abc123',
    scade: '2026-11-22T00:00:00.000Z',
  },
};

test('evidenze: validate, link solo verso il gestionale, voci sbagliate scartate', () => {
  const e = parseEvidence(evidenceAnswer, now);
  assert.equal(e.base, 'https://kassaro-os.onrender.com');
  assert.equal(e.salvato, now.toISOString());
  assert.deepEqual(e.riepilogo, { presenti: 1, parziali: 1, assenti: 1 });
  assert.equal(e.voci.length, 3);
  assert.equal(evidenceLink(e, e.voci[0]), 'https://kassaro-os.onrender.com/#/haccp');
  assert.equal(evidenceLink(e, e.voci[1]), null, 'niente link verso altri siti');
  assert.equal(evidenceLink(e, e.voci[2]), null, 'niente javascript:');
  assert.equal(e.voci[2].ultimo, undefined, 'solo date AAAA-MM-GG');
  assert.deepEqual(controlPage(e, now), {
    url: 'https://kassaro-os.onrender.com/controllo/abc123',
    scade: '2026-11-22T00:00:00.000Z',
  });
  assert.equal(controlPage(e, new Date('2026-11-23T00:00:00Z')), null, 'link scaduto');
  const foreign = parseEvidence(
    { ...evidenceAnswer, pagina_controlli: { attiva: true, url: 'https://altrove.example/controllo/x' } },
    now,
  );
  assert.equal(controlPage(foreign, now), null, 'pagina su un altro sito rifiutata');
  assert.equal(parseEvidence({ ...evidenceAnswer, base: 'http://kassaro-os.onrender.com' }, now), null);
  assert.equal(parseEvidence('<html>', now), null);
});

test('profilo: campi vuoti e segnaposto, senza mai i valori', () => {
  assert.deepEqual(
    profileGaps({
      name: 'Caffè del Kassaro',
      legalName: '',
      vat: '07434420829',
      address: 'Corso Vittorio Emanuele 390',
      city: 'Palermo',
      region: 'Sicilia',
      activity: 'Bar',
      reviewer: 'xxx',
      portalNotice: 'ciao',
      staff: 'Da confermare',
      dehors: 'Sì',
    }),
    {
      mancanti: ['Ragione sociale'],
      segnaposto: ['Revisore (legale o consulente)', 'Informativa del portale'],
      da_confermare: ['Personale dipendente'],
    },
  );
  assert.deepEqual(profileGaps({ portalNotice: 'Informativa '.repeat(5) }).segnaposto, [
    'Informativa del portale',
  ]);
});

test('da completare: documenti, requisiti coperti dal gestionale ancora da valutare', () => {
  const catalogue = [
    { id: 'cat-5-1', title: 'Manuale o piano di autocontrollo' },
    { id: 'cat-6-3', title: 'Schede ingredienti e allergeni' },
    { id: 'cat-6-9', title: 'Monitoraggio infestanti' },
  ];
  const s = holdingSummary({
    ...meta,
    owner: true,
    portalEnabled: false,
    catalogue,
    profile: {
      name: 'Caffè del Kassaro',
      vat: '07434420829',
      portalNotice: 'ciao',
      staff: 'Sì',
      dehors: 'Sì',
    },
    records: [
      doc('SCIA', '2027-01-01', { reviewed: true, catalogId: 'cat-1-1' }),
      doc('Visura', '', { reviewed: false }),
      doc('Planimetria', '', { reviewed: false, catalogIds: ['cat-2-1'] }),
      { kind: 'requirement', data: { catalogId: 'cat-6-3', status: 'Applicabile' } },
      { kind: 'evidence', data: parseEvidence(evidenceAnswer, now) },
    ],
  });
  const d = s.dati.da_completare;
  assert.deepEqual(d.documenti.da_verificare, 2);
  assert.deepEqual(d.documenti.senza_catalogo, 1);
  assert.deepEqual(d.documenti.senza_scadenza, 2);
  assert.match(d.documenti.nota, /non è validità illimitata/);
  assert.deepEqual(d.elenchi.documenti_da_verificare, ['Visura', 'Planimetria']);
  assert.deepEqual(d.elenchi.documenti_senza_catalogo, ['Visura']);
  // Covered by the management software and still undecided: only the manual (allergens already decided,
  // pests absent in the software).
  assert.equal(d.requisiti_coperti_da_valutare, 1);
  assert.deepEqual(d.elenchi.requisiti_coperti_da_valutare, [
    { titolo: 'Manuale o piano di autocontrollo', evidenza: 'presente' },
  ]);
  assert.deepEqual(d.evidenze_gestionale, {
    lette_il: now.toISOString(),
    presenti: 1,
    parziali: 1,
    assenti: 1,
  });
  assert.deepEqual(d.profilo.segnaposto, ['Informativa del portale']);
  const raw = JSON.stringify(s);
  for (const hidden of ['07434420829', 'ciao', 'controllo/abc123'])
    assert.ok(!raw.includes(hidden), `non deve uscire: ${hidden}`);
  assert.ok(raw.length <= 16_384);
});

test('evidenze dal gestionale: salvate ogni ora, l’ultima resta se la centrale non risponde', async () => {
  const { sqlite, add, db } = fixture();
  sqlite.exec("INSERT INTO admin_identity VALUES(1,'carlo')");
  add('d1', 'carlo', doc('SCIA', '2026-10-01'));
  const env = { DB: db, HOLDING_SEGNALE_KEY: 'kosw_' + 'k'.repeat(43) };
  const seen = [];
  const centrale =
    (evidence, status = 200) =>
    async (url, init) => {
      seen.push({ url, method: init.method, auth: init.headers.Authorization });
      if (init.method === 'GET') return new Response(JSON.stringify(evidence), { status });
      return new Response('{"ok":true}', { status: 200 });
    };
  const stored = () => sqlite.prepare("SELECT id,owner,kind,data FROM records WHERE kind='evidence'").all();

  const first = await runHolding(
    env,
    meta,
    [{ id: 'cat-5-1', title: 'Manuale o piano di autocontrollo' }],
    centrale(evidenceAnswer),
  );
  assert.deepEqual(first.evidenze, { saved: true, voci: 3 });
  assert.equal(first.segnale.sent, true);
  assert.deepEqual(
    seen.map(x => [x.method, x.url]),
    [
      ['GET', 'https://kassaro-os.onrender.com/api/holding/evidenze'],
      ['POST', HOLDING_URL],
    ],
  );
  assert.equal(seen[0].auth, `Bearer ${env.HOLDING_SEGNALE_KEY}`);
  assert.deepEqual(
    stored().map(r => [r.id, r.owner, r.kind]),
    [['evidenze:carlo', 'carlo', 'evidence']],
  );

  // Kassaro OS 8.2.0 answers the unknown path with a page, then goes offline: the saved reading stays.
  const later = { ...meta, now: new Date('2026-10-22T11:00:00Z') };
  const page = async (url, init) =>
    init.method === 'GET' ? new Response('<html></html>', { status: 200 }) : new Response('{}');
  assert.equal(
    (await syncEvidence(env, later.now, page)).reason,
    'Evidenze non valide (serve Kassaro OS 8.3.0)',
  );
  const down = async () => {
    throw new TypeError('fetch failed');
  };
  assert.deepEqual(await syncEvidence(env, later.now, down), {
    saved: false,
    reason: 'Centrale non raggiungibile',
  });
  assert.equal((await syncEvidence(env, later.now, centrale({}, 401))).status, 401);
  assert.equal(JSON.parse(stored()[0].data).salvato, now.toISOString(), 'resta la lettura delle 12');

  // Without the key nothing is read, nothing is called.
  seen.length = 0;
  assert.equal((await runHolding({ DB: db }, meta, [], centrale(evidenceAnswer))).segnale.sent, false);
  assert.equal(seen.length, 0);
});
