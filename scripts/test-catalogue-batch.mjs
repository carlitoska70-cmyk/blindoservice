import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleCatalogueBatch } from '../lib/catalogue-batch.ts';
import { withCatalogLinks } from '../lib/catalogue-matching.ts';
function fixture(count = 1) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE profiles(owner TEXT,data TEXT);CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,data TEXT,created TEXT,updated TEXT);',
  );
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
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  let user = 'owner',
    calls = 0,
    uncertain = false,
    recognizer = null;
  const data = i => ({
    title: 'Doc ' + i,
    fileId: 'file' + i,
    fileName: 'doc' + i + '.pdf',
    catalogId: 'prior',
    catalogIds: ['prior'],
    notes: 'Annotazione da mantenere',
    reviewed: false,
    reviewer: '',
  });
  for (let i = 0; i < count; i++)
    sqlite
      .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
      .run('doc' + i, 'owner', 'document', JSON.stringify(data(i)), 'v1', 'v1');
  const deps = {
    db,
    authorize: async () => (user ? { userId: user, displayName: 'Responsabile' } : null),
    link: withCatalogLinks,
    validIds: ids => ids.every(id => ['new', 'second'].includes(id)),
    decide: r => ({
      ids: uncertain ? [] : ['new'],
      candidates: [{ id: 'new', title: 'Voce', score: 100, reason: 'Tipo letto' }],
      reasons: uncertain ? ['Lettura incerta'] : [],
    }),
    recognize: async req => {
      calls++;
      if (recognizer) return recognizer(req);
      const { fileId } = await req.json();
      return Response.json({
        fileId,
        recognition: { fields: { title: { value: 'Doc' } }, quality: 'leggibile', model: 'fixture' },
      });
    },
  };
  const call = async (body, query = '', origin = 'https://app.test') => {
    const response = await handleCatalogueBatch(
      new Request(
        'https://app.test/api/documents/catalogue' + query,
        body ? { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) } : {},
      ),
      deps,
    );
    return { httpStatus: response.status, ...(await response.json()) };
  };
  const start = async () => {
    const r = await call({ action: 'start', confirm: true });
    assert.equal(r.httpStatus, 200);
    return r.job;
  };
  const view = job => call(undefined, '?job=' + job + '&state=all');
  const doc = i => JSON.parse(sqlite.prepare('SELECT data FROM records WHERE id=?').get('doc' + i).data);
  return {
    sqlite,
    db,
    deps,
    call,
    start,
    view,
    doc,
    user: v => (user = v),
    uncertain: v => (uncertain = v),
    recognizer: f => (recognizer = f),
    calls: () => calls,
  };
}
test('start snapshots all archived documents once and recovery returns the same active queue', async () => {
  const f = fixture(3);
  const job = await f.start();
  assert.equal(await f.start(), job);
  assert.equal((await f.view(job)).counts.queued, 3);
  assert.equal(f.calls(), 0);
  await f.call({ action: 'step', job });
  assert.equal((await f.view(job)).counts.applied, 1);
  assert.equal((await f.view(job)).counts.queued, 2);
  assert.equal(await f.start(), job);
  await f.call({ action: 'step', job });
  await f.call({ action: 'step', job });
  assert.equal(f.calls(), 3);
  assert.equal((await f.view(job)).job.active, false);
});
test('automatic application preserves metadata and old links, writes a revision and survives reload', async () => {
  const f = fixture(),
    job = await f.start();
  assert.equal((await f.call({ action: 'step', job })).status, 'applied');
  assert.deepEqual(f.doc(0).catalogIds, ['prior', 'new']);
  assert.equal(f.doc(0).reviewed, false);
  assert.equal(f.doc(0).notes, 'Annotazione da mantenere');
  const rev = JSON.parse(f.sqlite.prepare("SELECT data FROM records WHERE kind='revision'").get().data);
  assert.equal(rev.data.catalogId, 'prior');
  assert.equal(rev.decision, 'automatico');
  assert.equal(rev.catalogueBatch, job);
  const row = (await f.view(job)).items[0];
  assert.deepEqual(row.added, ['new']);
  assert.equal(row.analysis.fileId, 'file0');
  assert.equal(row.analysis.recognition.model, 'fixture');
  assert.equal((await f.call({ action: 'step', job })).done, true);
  assert.equal(f.calls(), 1);
});
test('uncertain documents wait for human choice; invalid choices cannot be saved', async () => {
  const f = fixture();
  f.uncertain(true);
  const job = await f.start();
  await f.call({ action: 'step', job });
  const item = (await f.view(job)).items[0];
  assert.equal(item.status, 'review');
  assert.deepEqual(f.doc(0).catalogIds, ['prior']);
  assert.equal((await f.call({ action: 'approve', job, id: item.id, ids: ['unknown'] })).httpStatus, 400);
  assert.equal((await f.call({ action: 'approve', job, id: item.id, ids: ['new', 'second'] })).ok, true);
  assert.deepEqual(f.doc(0).catalogIds, ['prior', 'new', 'second']);
  assert.equal((await f.call({ action: 'approve', job, id: item.id, ids: ['new'] })).ok, true);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM records WHERE kind='revision'").get().n, 1);
});
test('undo removes only links added by this job and produces a second revision', async () => {
  const f = fixture(),
    job = await f.start();
  await f.call({ action: 'step', job });
  const item = (await f.view(job)).items[0];
  assert.equal((await f.call({ action: 'undo', job, id: item.id })).ok, true);
  assert.deepEqual(f.doc(0).catalogIds, ['prior']);
  assert.equal(f.doc(0).fileId, 'file0');
  assert.equal((await f.view(job)).items[0].status, 'undone');
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM records WHERE kind='revision'").get().n, 2);
  assert.equal((await f.call({ action: 'undo', job, id: item.id })).ok, true);
});
test('changed records cannot be automatically applied, human-approved or undone', async () => {
  const f = fixture(),
    job = await f.start();
  f.sqlite.prepare('UPDATE records SET updated=? WHERE id=?').run('v2', 'doc0');
  await f.call({ action: 'step', job });
  assert.equal(f.calls(), 0);
  let item = (await f.view(job)).items[0];
  assert.equal(item.status, 'conflict');
  assert.equal((await f.call({ action: 'retry', job, id: item.id })).ok, true);
  await f.call({ action: 'step', job });
  item = (await f.view(job)).items[0];
  assert.equal(item.status, 'applied');
  f.sqlite.prepare('UPDATE records SET updated=? WHERE id=?').run('manual-change', 'doc0');
  assert.equal((await f.call({ action: 'undo', job, id: item.id })).httpStatus, 409);
  assert.ok(f.doc(0).catalogIds.includes('new'));
  const g = fixture();
  g.uncertain(true);
  const gj = await g.start();
  await g.call({ action: 'step', job: gj });
  const gi = (await g.view(gj)).items[0];
  g.sqlite.prepare('UPDATE records SET updated=? WHERE id=?').run('v2', 'doc0');
  assert.equal((await g.call({ action: 'approve', job: gj, id: gi.id, ids: ['new'] })).httpStatus, 409);
});
test('an edit during remote reading causes a conflict without overwriting the edit', async () => {
  const f = fixture(),
    job = await f.start();
  f.recognizer(async req => {
    const { fileId } = await req.json();
    f.sqlite
      .prepare('UPDATE records SET updated=?,data=? WHERE id=?')
      .run('v2', JSON.stringify({ ...f.doc(0), notes: 'Corretto durante lettura' }), 'doc0');
    return Response.json({ fileId, recognition: { fields: {} } });
  });
  await f.call({ action: 'step', job });
  assert.equal((await f.view(job)).items[0].status, 'conflict');
  assert.equal(f.doc(0).notes, 'Corretto durante lettura');
  assert.deepEqual(f.doc(0).catalogIds, ['prior']);
});
test('expired leases are recoverable and old workers cannot commit after losing their token', async () => {
  const f = fixture(),
    job = await f.start();
  f.recognizer(async req => {
    const { fileId } = await req.json();
    f.sqlite.exec("UPDATE catalogue_items SET token='new-worker',lease=9999999999999");
    return Response.json({ fileId, recognition: { fields: {} } });
  });
  await f.call({ action: 'step', job });
  assert.deepEqual(f.doc(0).catalogIds, ['prior']);
  assert.equal((await f.view(job)).items[0].status, 'processing');
  assert.equal((await f.call({ action: 'step', job })).busy, true);
  f.sqlite.exec('UPDATE catalogue_items SET lease=0');
  f.recognizer(null);
  await f.call({ action: 'step', job });
  assert.equal((await f.view(job)).items[0].status, 'applied');
});
test('service failures stop automatic processing, persist the error and can be retried', async () => {
  const f = fixture(),
    job = await f.start();
  f.recognizer(async () => Response.json({ error: 'Credito da verificare' }, { status: 502 }));
  assert.equal((await f.call({ action: 'step', job })).stop, true);
  let v = await f.view(job);
  assert.equal(v.items[0].status, 'error');
  assert.equal(v.job.active, false);
  await f.call({ action: 'retry', job, id: v.items[0].id });
  f.recognizer(null);
  await f.call({ action: 'step', job });
  assert.equal((await f.view(job)).items[0].status, 'applied');
});
test('missing originals and already-linked records do not create false new coverage', async () => {
  const f = fixture(2);
  f.sqlite
    .prepare('UPDATE records SET data=? WHERE id=?')
    .run(JSON.stringify({ ...f.doc(0), fileId: '' }), 'doc0');
  f.sqlite
    .prepare('UPDATE records SET data=? WHERE id=?')
    .run(JSON.stringify({ ...f.doc(1), catalogIds: ['prior', 'new'] }), 'doc1');
  const job = await f.start();
  await f.call({ action: 'step', job });
  const view = await f.view(job);
  assert.equal(view.counts.skipped, 2);
  assert.equal(f.calls(), 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM records WHERE kind='revision'").get().n, 0);
});
test('authentication, ownership and origin are enforced before mutation or model calls', async () => {
  const f = fixture(),
    job = await f.start();
  f.user('other');
  assert.equal((await f.view(job)).httpStatus, 404);
  assert.equal((await f.call({ action: 'step', job })).httpStatus, 404);
  f.user(null);
  assert.equal((await f.view(job)).httpStatus, 401);
  f.user('owner');
  assert.equal((await f.call({ action: 'start', confirm: true }, '', 'https://evil.test')).httpStatus, 403);
  assert.equal(f.calls(), 0);
});
test('human rejection retains evidence and requires a reason', async () => {
  const f = fixture();
  f.uncertain(true);
  const job = await f.start();
  await f.call({ action: 'step', job });
  const item = (await f.view(job)).items[0];
  assert.equal((await f.call({ action: 'reject', job, id: item.id, note: '' })).httpStatus, 400);
  assert.equal(
    (await f.call({ action: 'reject', job, id: item.id, note: 'Documento di altra attività' })).ok,
    true,
  );
  const v = (await f.view(job)).items[0];
  assert.equal(v.status, 'rejected');
  assert.ok(v.analysis.recognition);
  assert.deepEqual(f.doc(0).catalogIds, ['prior']);
});
test('large job pages cover all records without duplicates and filters keep totals', async () => {
  const f = fixture(205),
    job = await f.start();
  const pages = [];
  for (const offset of [0, 100, 200])
    pages.push(await f.call(undefined, '?job=' + job + '&state=queued&limit=100&offset=' + offset));
  assert.deepEqual(
    pages.map(p => p.items.length),
    [100, 100, 5],
  );
  assert.equal(new Set(pages.flatMap(p => p.items.map(i => i.id))).size, 205);
  assert.equal(pages[0].counts.queued, 205);
});
test('exceptions and a mismatched recognition response release the last job without applying anything', async () => {
  for (const wrong of [false, true]) {
    const f = fixture(),
      job = await f.start();
    f.recognizer(async () => {
      if (!wrong) throw new Error('Network');
      return Response.json({ fileId: 'foreign', recognition: { fields: {} } });
    });
    const result = await f.call({ action: 'step', job });
    assert.equal(result.stop, true);
    const view = await f.view(job);
    assert.equal(view.job.active, false);
    assert.equal(view.items[0].status, 'error');
    assert.deepEqual(f.doc(0).catalogIds, ['prior']);
  }
});
test('empty archives finish immediately and too-large requests cannot start jobs', async () => {
  const f = fixture(0),
    job = await f.start();
  assert.equal((await f.view(job)).job.active, false);
  assert.equal((await f.call({ action: 'step', job })).done, true);
  assert.equal(
    (await f.call({ action: 'start', confirm: true, padding: 'x'.repeat(12001) })).httpStatus,
    413,
  );
  assert.equal(f.calls(), 0);
});
