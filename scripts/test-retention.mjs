import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  CONTROL_DAYS,
  RELEASE_DAYS,
  childFiles,
  inspectionDue,
  retentionPlan,
  runRetention,
  visitDue,
} from '../lib/retention.ts';
import { NOTICE_DAYS, NOTICE_TODO, noticeProblem, portalNoticeTemplate } from '../lib/portal-notice.ts';
import { SENSITIVE_STAFF_DOC, staffDocUntil, staffRecordUntil } from '../lib/staff.ts';

const DAY = 86_400_000;
const inspection = (id, data = {}, created = '2026-06-01T08:00:00.000Z') => ({
  id,
  kind: 'inspection',
  created,
  data: {
    authority: 'ASP Palermo',
    scope: 'Verifica HACCP',
    officers: 'Mario Rossi · Ispettore',
    reference: 'Prot. 1/2026',
    status: 'concluso',
    outcome: 'Nessuna irregolarità',
    started: '2026-06-01T08:00:00.000Z',
    ended: '2026-06-01T09:00:00.000Z',
    ...data,
  },
});
const plus = (iso, days) => new Date(Date.parse(iso) + days * DAY).toISOString();

test('120 giorni dall’ultima attività, contando note, audio e visite', () => {
  const i = inspection('i1');
  assert.equal(inspectionDue(i).due, plus('2026-06-01T09:00:00.000Z', CONTROL_DAYS));
  const late = [
    { id: 'e1', kind: 'event', created: '2026-06-10T10:00:00.000Z', data: { inspectionId: 'i1' } },
  ];
  assert.equal(inspectionDue(i, late).due, plus('2026-06-10T10:00:00.000Z', CONTROL_DAYS));
  const visit = {
    id: 'v',
    inspection_id: 'i1',
    created: '2026-06-01T07:55:00.000Z',
    last_seen: '2026-06-12T08:00:00.000Z',
  };
  assert.equal(inspectionDue(i, late, [visit]).due, plus('2026-06-12T08:00:00.000Z', CONTROL_DAYS));
});

test('procedimento in corso blocca, chiuso riparte da 30 giorni', () => {
  const held = inspection('i1', { procedimento: { dal: '2026-07-01', riferimento: 'Verbale 12', nota: '' } });
  assert.deepEqual(inspectionDue(held), { due: null, reason: 'procedimento' });
  const closed = inspection('i1', {
    procedimento: { dal: '2026-07-01', riferimento: 'Verbale 12', nota: '' },
    procedimentoChiuso: '2027-03-01T10:00:00.000Z',
  });
  assert.deepEqual(inspectionDue(closed), {
    due: plus('2027-03-01T10:00:00.000Z', RELEASE_DAYS),
    reason: 'chiuso',
  });
});

test('piano: cancella, avvisa 14 giorni prima, salta gli anonimizzati e i bloccati', () => {
  const now = new Date(plus('2026-06-01T09:00:00.000Z', CONTROL_DAYS - 5));
  const plan = retentionPlan({
    now,
    inspections: [
      inspection('due-soon'),
      // Created long ago, but the control itself ended on 1/6: the latest date counts.
      inspection('old', {}, '2026-01-01T08:00:00.000Z'),
      inspection(
        'old-ended',
        { started: '2026-01-01T08:00:00.000Z', ended: '2026-01-01T09:00:00.000Z' },
        '2026-01-01T08:00:00.000Z',
      ),
      inspection(
        'held',
        {
          procedimento: { dal: '', riferimento: '', nota: '' },
          started: '2025-01-01T00:00:00.000Z',
          ended: '',
        },
        '2025-01-01T00:00:00.000Z',
      ),
      inspection(
        'gone',
        { anonimizzato: '2026-05-01T00:00:00.000Z', started: '2025-01-01T00:00:00.000Z', ended: '' },
        '2025-01-01T00:00:00.000Z',
      ),
    ],
    children: [],
    visits: [
      {
        id: 'lonely-old',
        inspection_id: null,
        created: '2026-01-01T00:00:00.000Z',
        last_seen: '2026-01-01T00:10:00.000Z',
      },
      {
        id: 'lonely-new',
        inspection_id: null,
        created: '2026-09-01T00:00:00.000Z',
        last_seen: '2026-09-01T00:10:00.000Z',
      },
      {
        id: 'linked',
        inspection_id: 'due-soon',
        created: '2026-01-01T00:00:00.000Z',
        last_seen: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  assert.deepEqual(
    plan.warn.map(p => p.id),
    ['due-soon', 'old'],
  );
  assert.deepEqual(
    plan.purge.map(p => p.id),
    ['old-ended'],
  );
  assert.deepEqual(plan.held, ['held']);
  assert.deepEqual(plan.visits, ['lonely-old']);
  assert.equal(
    visitDue({ created: '2026-01-01T00:00:00.000Z', last_seen: '' }),
    plus('2026-01-01T00:00:00.000Z', CONTROL_DAYS),
  );
});

test('file degli allegati: audio, rapporti PDF e registrazioni live', () => {
  assert.deepEqual(
    childFiles([
      { data: { fileId: 'a1' } },
      { data: { audioFileId: 'a2', pdfFileId: 'p1' } },
      { data: { fileId: '' } },
      { data: { fileId: 'a1' } },
    ]).sort(),
    ['a1', 'a2', 'p1'],
  );
});

test('dipendenti cessati: identità 12 mesi, permesso 6 anni, il resto 5', () => {
  const emp = { active: false, endDate: '2026-03-31' };
  const doc = title => ({ title, documentType: '', category: 'Personale e formazione' });
  assert.deepEqual(staffDocUntil(emp, doc('Documento di identità – Mario')), {
    key: 'identita',
    until: '2027-03-31',
  });
  assert.deepEqual(staffDocUntil(emp, doc('Codice fiscale / tessera sanitaria – Mario')), {
    key: 'codicefiscale',
    until: '2027-03-31',
  });
  assert.deepEqual(staffDocUntil(emp, doc('Permesso di soggiorno – Mario')), {
    key: 'permesso',
    until: '2032-03-31',
  });
  assert.deepEqual(staffDocUntil(emp, doc('UNILAV assunzione – Mario')), {
    key: 'altro',
    until: '2031-03-31',
  });
  assert.equal(staffRecordUntil(emp), '2031-03-31');
  // Still employed, or no end date: nothing can be deleted.
  assert.equal(staffDocUntil({ active: true, endDate: '2026-03-31' }, doc('Documento di identità')), null);
  assert.equal(staffDocUntil({ active: false, endDate: '' }, doc('Documento di identità')), null);
  assert.equal(staffRecordUntil({ active: false, endDate: '' }), null);
});

test('documenti personali che non vanno all’IA', () => {
  for (const t of [
    'Documento di identità – Mario',
    'Permesso di soggiorno',
    'Codice fiscale',
    'Busta paga luglio',
    'Certificato medico',
  ])
    assert.match(t, SENSITIVE_STAFF_DOC);
  for (const t of ['Attestato HACCP – Mario', 'UNILAV assunzione', 'Formazione art. 37'])
    assert.doesNotMatch(t, SENSITIVE_STAFF_DOC);
});

test('informativa del portale: modello da completare e blocco dell’attivazione', () => {
  assert.equal(NOTICE_DAYS, CONTROL_DAYS);
  const t = portalNoticeTemplate({
    name: 'Bar Test',
    legalName: '',
    vat: '',
    address: 'Via Roma 1',
    city: 'Palermo',
  });
  assert.match(t, /Via Roma 1, Palermo/);
  assert.match(t, new RegExp(`${CONTROL_DAYS} giorni`));
  assert.doesNotMatch(t, /targa/i);
  assert.match(noticeProblem(t), new RegExp(NOTICE_TODO));
  assert.match(noticeProblem('ciao'), /Completa l’informativa/);
  assert.equal(noticeProblem(t.replaceAll(/\[DA COMPLETARE: [^\]]+\]/g, 'Mario Rossi, info@bar.test')), null);
});

/** D1 and R2 on SQLite and a Map, with the tables the retention run touches. */
function fakeEnv() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,data TEXT,created TEXT,updated TEXT);' +
      'CREATE TABLE files(id TEXT PRIMARY KEY,owner TEXT,name TEXT,mime TEXT,object_key TEXT,sha256 TEXT,created TEXT);' +
      'CREATE TABLE visits(id TEXT PRIMARY KEY,owner TEXT,portal_id TEXT,token_hash TEXT,status TEXT,data TEXT,inspection_id TEXT,created TEXT,expires TEXT,last_seen TEXT,active_doc TEXT,active_page INTEGER);' +
      'CREATE TABLE grants(id TEXT PRIMARY KEY,owner TEXT,visit_id TEXT,document_id TEXT,file_id TEXT,title TEXT,description TEXT,version TEXT,created TEXT);' +
      'CREATE TABLE portal_events(id TEXT PRIMARY KEY,owner TEXT,visit_id TEXT,kind TEXT,data TEXT,created TEXT);',
  );
  const stmt = (query, params = []) => ({
    bind: (...v) => stmt(query, v),
    first: async () => sqlite.prepare(query).get(...params) || null,
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...params).changes) } }),
  });
  const objects = new Map();
  const env = {
    DB: {
      prepare: q => stmt(q),
      batch: async list => {
        const out = [];
        for (const s of list) out.push(await s.run());
        return out;
      },
    },
    BUCKET: { delete: async key => void objects.delete(key) },
  };
  const rec = (id, kind, data, created = '2026-06-01T08:00:00.000Z', owner = 'o1') =>
    sqlite
      .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
      .run(id, owner, kind, JSON.stringify(data), created, created);
  const file = (id, key) => {
    sqlite
      .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
      .run(id, 'o1', id, 'audio/webm', key, 'h', '2026-06-01');
    objects.set(key, 'bytes');
  };
  return { sqlite, env, rec, file, objects };
}

test('pulizia sul database: dati personali via, scheda breve e documenti dell’archivio restano', async () => {
  const { sqlite, env, rec, file, objects } = fakeEnv();
  rec('i1', 'inspection', inspection('i1').data);
  rec('e1', 'event', {
    inspectionId: 'i1',
    speaker: 'Rossi',
    text: 'chiede la SCIA',
    tag: 'Registrazione',
    fileId: 'audio1',
  });
  rec('e2', 'event', {
    inspectionId: 'i1',
    speaker: 'Rossi',
    text: 'SCIA esibita',
    tag: 'Documento esibito',
    fileId: 'shared',
  });
  rec('t1', 'transcript', { inspectionId: 'i1', eventId: 'e1', fileId: 'audio1', text: 'Sono Mario Rossi' });
  rec('r1', 'report', { inspectionId: 'i1', audioFileId: 'audio1', pdfFileId: 'pdf1' });
  rec('l1', 'ascolto', { fileId: 'audio1' });
  rec('rev', 'revision', { recordId: 'i1', kind: 'inspection', data: { officers: 'Mario Rossi' } });
  rec('d1', 'document', { title: 'SCIA', fileId: 'shared' });
  rec(
    'i2',
    'inspection',
    inspection('i2', { procedimento: { dal: '2026-07-01', riferimento: 'V 1', nota: '' } }).data,
  );
  rec('e3', 'event', { inspectionId: 'i2', speaker: 'Bianchi', text: 'nota', tag: 'Nota', fileId: 'audio2' });
  for (const [id, key] of [
    ['audio1', 'k-audio1'],
    ['pdf1', 'k-pdf1'],
    ['shared', 'k-shared'],
    ['audio2', 'k-audio2'],
  ])
    file(id, key);
  const visit = (id, inspectionId, seen) =>
    sqlite
      .prepare('INSERT INTO visits VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        'o1',
        'p',
        'h' + id,
        'chiusa',
        JSON.stringify({ firstName: 'Mario' }),
        inspectionId,
        seen,
        seen,
        seen,
        null,
        null,
      );
  visit('v1', 'i1', '2026-06-01T08:30:00.000Z');
  visit('v2', null, '2026-02-01T08:30:00.000Z');
  visit('v3', null, '2026-10-20T08:30:00.000Z');
  for (const v of ['v1', 'v2', 'v3']) {
    sqlite
      .prepare('INSERT INTO portal_events VALUES(?,?,?,?,?,?)')
      .run('pe' + v, 'o1', v, 'ricerca', '{}', '2026-06-01');
    sqlite
      .prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?,?)')
      .run('g' + v, 'o1', v, 'd1', 'shared', 'SCIA', '', '1', '2026-06-01');
  }

  // Before the term nothing goes, but the run is recorded.
  let r = await runRetention(env, new Date('2026-07-01T00:00:00.000Z'), true);
  assert.deepEqual(r.report.o1, { controlli: 0, sessioni: 1, file: 0, documenti: 0 }); // only the lonely old visit v2
  const state0 = JSON.parse(sqlite.prepare("SELECT data FROM records WHERE kind='retention'").get().data);
  assert.equal(state0.lastPurge, '2026-07-01T00:00:00.000Z');

  // A second run within 20 hours is skipped.
  r = await runRetention(env, new Date('2026-07-01T10:00:00.000Z'));
  assert.deepEqual(r.report, {});

  r = await runRetention(env, new Date('2026-10-22T00:00:00.000Z'));
  assert.deepEqual(r.report.o1, { controlli: 1, sessioni: 1, file: 2, documenti: 0 });
  const ids = sqlite
    .prepare('SELECT id FROM records ORDER BY id')
    .all()
    .map(x => x.id);
  assert.deepEqual(ids, ['d1', 'e3', 'i1', 'i2', 'retention:o1']);
  const i1 = JSON.parse(sqlite.prepare("SELECT data FROM records WHERE id='i1'").get().data);
  assert.equal(i1.officers, '');
  assert.equal(i1.anonimizzato, '2026-10-22T00:00:00.000Z');
  assert.equal(i1.authority, 'ASP Palermo');
  assert.equal(i1.outcome, 'Nessuna irregolarità');
  // Audio and PDF report gone from R2; the archive document's file stays; the held file keeps its audio.
  assert.deepEqual([...objects.keys()].sort(), ['k-audio2', 'k-shared']);
  assert.deepEqual(
    sqlite
      .prepare('SELECT id FROM visits ORDER BY id')
      .all()
      .map(x => x.id),
    ['v3'],
  );
  assert.deepEqual(
    sqlite
      .prepare('SELECT visit_id FROM portal_events')
      .all()
      .map(x => x.visit_id),
    ['v3'],
  );
  assert.deepEqual(
    sqlite
      .prepare('SELECT visit_id FROM grants')
      .all()
      .map(x => x.visit_id),
    ['v3'],
  );
  const state = JSON.parse(sqlite.prepare("SELECT data FROM records WHERE kind='retention'").get().data);
  assert.equal(state.lastPurge, '2026-10-22T00:00:00.000Z');
  assert.equal(state.history.length, 2);

  // Anonymised files are not touched again.
  r = await runRetention(env, new Date('2027-01-01T00:00:00.000Z'));
  assert.deepEqual(r.report.o1, { controlli: 0, sessioni: 0, file: 0, documenti: 0 });
});

test('pulizia: errori registrati, mai eccezioni', async () => {
  const r = await runRetention(
    {
      DB: {
        prepare: () => ({
          all: async () => {
            throw new Error('D1 giù');
          },
        }),
      },
    },
    new Date(),
    true,
  );
  assert.deepEqual(r, { ok: false, error: 'pulizia non riuscita' });
  assert.deepEqual(await runRetention({}), { ok: false, error: 'database non disponibile' });
});
