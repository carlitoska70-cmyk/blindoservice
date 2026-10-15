// Server contract tests against real route handlers and SQLite. No browser/network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = process.cwd(),
  dir = mkdtempSync(join(tmpdir(), 'presidio-test-'));
const database = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter(f => f.endsWith('.sql'))
  .sort())
  database.exec(readFileSync(join('drizzle', file), 'utf8'));
database.exec(readFileSync('scripts/admin-login-schema.sql', 'utf8'));
symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
class Statement {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.sql, args);
  }
  async first() {
    return database.prepare(this.sql).get(...this.args) || null;
  }
  async all() {
    return { results: database.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const r = database.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}
const bucket = new Map();
globalThis.__presidioTest = {
  user: null,
  env: {
    PRESIDIO_OWNER_EMAIL: 'owner@example.test',
    PRESIDIO_STAFF_EMAIL: 'staff@example.test',
    DB: {
      prepare: q => new Statement(q),
      batch: async stmts => {
        database.exec('BEGIN');
        try {
          const result = [];
          for (const s of stmts) result.push(await s.run());
          database.exec('COMMIT');
          return result;
        } catch (e) {
          database.exec('ROLLBACK');
          throw e;
        }
      },
    },
    BUCKET: {
      put: async (key, value) =>
        bucket.set(key, value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : String(value)),
      get: async key =>
        bucket.has(key)
          ? {
              body: new Blob([bucket.get(key)]).stream(),
              arrayBuffer: async () => new TextEncoder().encode(bucket.get(key)).buffer,
            }
          : null,
    },
  },
};
writeFileSync(
  join(dir, 'harness.mjs'),
  `export const env=globalThis.__presidioTest.env;export async function getChatGPTUser(){return globalThis.__presidioTest.user}export async function getMember(){const u=globalThis.__presidioTest.user;if(!u)return null;const role=u.email===env.PRESIDIO_OWNER_EMAIL?'owner':u.email===env.PRESIDIO_STAFF_EMAIL?'staff':null;return role?{...u,role}:null}export async function getOperator(){const u=await getMember();return u&&u.role==='owner'?u:null}export const requireOperator=getOperator;export const requireMember=getMember;export const chatGPTSignInPath=()=>'/signin-with-chatgpt';export function redirect(){throw new Error('redirect')}`,
);
const files = [
  'lib/catalogue.ts',
  'lib/product.ts',
  'lib/document-schema.ts',
  'lib/schemas.ts',
  'lib/portal-server.ts',
  'lib/grants.ts',
  'lib/notify.ts',
  'lib/search-terms.ts',
  'lib/openai.ts',
  'app/api/state/route.ts',
  'app/api/files/route.ts',
  'app/api/portal/route.ts',
  'app/api/portal/file/route.ts',
  'app/api/control-room/route.ts',
  'app/api/assistant/route.ts',
  'lib/live.ts',
  'lib/text-pdf.ts',
  'app/api/live/route.ts',
];
for (const file of files) {
  let source = readFileSync(file, 'utf8');
  source = source
    .replace(
      /(['"])(cloudflare:workers|@\/app\/chatgpt-auth|@\/lib\/operator|next\/navigation)\1/g,
      JSON.stringify(pathToFileURL(join(dir, 'harness.mjs')).href),
    )
    .replace(/(['"])@\/([^'"]+)\1/g, (_, q, p) => JSON.stringify(pathToFileURL(join(dir, p + '.mjs')).href))
    .replace(/(['"])(\.\/[a-z-]+)\1/g, "'$2.mjs'");
  const out = join(dir, file.replace(/\.ts$/, '.mjs'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
const mod = async path => import(pathToFileURL(join(dir, path + '.mjs')).href);
const state = await mod('app/api/state/route'),
  portal = await mod('app/api/portal/route'),
  room = await mod('app/api/control-room/route'),
  file = await mod('app/api/portal/file/route'),
  privateFile = await mod('app/api/files/route'),
  ai = await mod('app/api/assistant/route'),
  liveApi = await mod('app/api/live/route');
const origin = 'https://presidio.test';
let cookie = '';
const req = (path, body, ck = cookie) =>
  new Request(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(ck ? { Cookie: ck } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const json = async response => ({ status: response.status, data: await response.json() });
const owner = () => {
  globalThis.__presidioTest.user = { userId: 'owner-id', email: 'owner@example.test' };
};
const anon = () => {
  globalThis.__presidioTest.user = null;
};
let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log('PASS ' + name);
};
try {
  check('anonymous private API rejected', () => {});
  assert.equal((await state.GET()).status, 401);
  assert.equal((await room.GET()).status, 401);
  assert.equal((await privateFile.GET(req('/api/files?id=f1'))).status, 401);
  globalThis.__presidioTest.user = { userId: 'other', email: 'other@example.test' };
  assert.equal((await state.GET()).status, 401);
  passed++;
  owner();
  database.prepare('INSERT INTO profiles VALUES(?,?,?)').run(
    'owner-id',
    JSON.stringify({
      name: 'Test company',
      portalNotice: 'Informativa di prova. '.repeat(20),
      vat: 'SECRET_VAT',
    }),
    new Date().toISOString(),
  );
  assert.equal((await room.POST(req('/api/control-room', { action: 'portal', enabled: true }))).status, 200);
  const p = database.prepare('SELECT id FROM portals').get().id;
  anon();
  let r = await portal.POST(req('/api/portal', { action: 'start', portal: p }, ''));
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const visit = (await r.json()).visit.id;
  assert(!database.prepare('SELECT token_hash FROM visits').get().token_hash.includes(cookie.split('=')[1]));
  passed++;
  let x = await json(await portal.GET(req('/api/portal?portal=' + p)));
  assert(!JSON.stringify(x.data).includes('SECRET_VAT'));
  assert.deepEqual(x.data.history, []);
  passed++;
  assert.equal(
    (await portal.POST(req('/api/portal', { action: 'identify', data: { firstName: '', lastName: '' } })))
      .status,
    400,
  );
  assert.equal((await portal.POST(req('/api/portal', { action: 'search', query: 'SCIA' }))).status, 403);
  passed++;
  const identity = {
    firstName: 'Nome',
    lastName: 'Cognome',
    office: 'Ufficio',
    role: 'Ruolo',
    purpose: 'Controllo test',
    plate: '',
    noticeRead: true,
  };
  // Plate is required (nome, cognome, targa, ufficio).
  assert.equal((await portal.POST(req('/api/portal', { action: 'identify', data: identity }))).status, 400);
  identity.plate = 'AB123CD';
  assert.equal((await portal.POST(req('/api/portal', { action: 'identify', data: identity }))).status, 200);
  assert.equal((await portal.POST(req('/api/portal', { action: 'identify', data: identity }))).status, 409);
  assert.equal((await portal.POST(req('/api/portal', { action: 'search', query: 'SCIA' }))).status, 403);
  passed++;
  const now = new Date().toISOString();
  for (const [id, title] of [
    ['d1', 'SCIA test'],
    ['d2', 'HACCP test'],
  ]) {
    database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(
      id,
      'owner-id',
      'document',
      JSON.stringify({
        title,
        category: 'Titoli e SCIA',
        notes: 'PRIVATE_INTERNAL',
        fileId: 'f' + id,
        publicDescription: 'Documento per il controllo',
      }),
      now,
      now,
    );
    database
      .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
      .run('f' + id, 'owner-id', title + '.pdf', 'application/pdf', 'obj' + id, 'hash-' + id, now);
    bucket.set('obj' + id, '%PDF-original-' + id);
  }
  owner();
  assert.equal(
    (
      await room.POST(
        req('/api/control-room', {
          action: 'grants',
          visitId: visit,
          identityVerified: false,
          documentIds: ['d1'],
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await room.POST(
        req('/api/control-room', {
          action: 'grants',
          visitId: visit,
          identityVerified: true,
          documentIds: ['foreign'],
        }),
      )
    ).status,
    400,
  );
  r = await room.POST(
    req('/api/control-room', {
      action: 'grants',
      visitId: visit,
      identityVerified: true,
      documentIds: ['d1'],
    }),
  );
  assert.equal(r.status, 200);
  const inspectionId = (await r.json()).inspectionId;
  passed++;
  anon();
  x = await json(await portal.GET(req('/api/portal?portal=' + p)));
  assert.deepEqual(x.data.history, []);
  r = await portal.POST(req('/api/portal', { action: 'search', query: 'SCIA' }));
  x = await json(r);
  assert.equal(x.data.documents.length, 1);
  assert.equal(x.data.documents[0].id, 'd1');
  assert(!JSON.stringify(x.data).includes('PRIVATE_INTERNAL'));
  x = await json(await portal.GET(req('/api/portal?portal=' + p)));
  assert.deepEqual(
    x.data.history.map(d => d.id),
    ['d1'],
  );
  passed++;
  assert.equal((await portal.POST(req('/api/portal', { action: 'open', documentId: 'd2' }))).status, 404);
  assert.equal((await file.GET(req('/api/portal/file?document=d2'))).status, 404);
  assert.equal((await privateFile.GET(req('/api/files?id=fd1'))).status, 401);
  passed++;
  assert.equal((await portal.POST(req('/api/portal', { action: 'open', documentId: 'd1' }))).status, 200);
  r = await file.GET(req('/api/portal/file?document=d1'));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '%PDF-original-d1');
  assert.equal(database.prepare('SELECT active_doc FROM visits').get().active_doc, 'd1');
  passed++;
  database
    .prepare('UPDATE records SET data=? WHERE id=?')
    .run(JSON.stringify({ title: 'new title', fileId: 'newFile' }), 'd1');
  assert.equal(await (await file.GET(req('/api/portal/file?document=d1'))).text(), '%PDF-original-d1');
  passed++;
  owner();
  assert.equal(
    (await ai.POST(req('/api/assistant', { action: 'transcribe', inspectionId, eventId: 'unknown' }))).status,
    503,
  );
  passed++;
  x = await json(await room.POST(req('/api/control-room', { action: 'report', visitId: visit })));
  assert(x.data.text.includes('hash-d1'));
  assert(x.data.text.includes('SCIA test'));
  passed++;
  assert.equal(
    (
      await room.POST(
        new Request(origin + '/api/control-room', {
          method: 'POST',
          headers: { Origin: 'https://evil.test' },
          body: JSON.stringify({ action: 'portal', enabled: false }),
        }),
      )
    ).status,
    403,
  );
  passed++;
  assert.equal((await room.POST(req('/api/control-room', { action: 'revoke', visitId: visit }))).status, 200);
  anon();
  assert.equal((await file.GET(req('/api/portal/file?document=d1'))).status, 403);
  assert.equal((await portal.POST(req('/api/portal', { action: 'search', query: 'SCIA' }))).status, 401);
  passed++;
  r = await portal.POST(req('/api/portal', { action: 'start', portal: p }, ''));
  const cookie2 = r.headers.get('set-cookie').split(';')[0];
  database.prepare('UPDATE visits SET expires=?').run('2020-01-01T00:00:00Z');
  assert.equal((await portal.POST(req('/api/portal', { action: 'heartbeat' }, cookie2))).status, 401);
  passed++;
  // Revision history stays out of the live state and is returned only for the export.
  owner();
  database
    .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .run('rev1', 'owner-id', 'revision', JSON.stringify({ recordId: 'd1' }), now, now);
  const kinds = async path => (await json(await state.GET(req(path)))).data.records.map(r => r.kind);
  assert(!(await kinds('/api/state')).includes('revision'));
  assert((await kinds('/api/state?revisions=1')).includes('revision'));
  passed++;
  // Archive / restore: archived records cannot be edited or shown to inspectors.
  const post = body => state.POST(req('/api/state', body));
  const d2v = () => database.prepare('SELECT updated FROM records WHERE id=?').get('d2').updated;
  const before = d2v();
  assert.equal((await post({ action: 'archive', kind: 'event', id: 'd2', version: before })).status, 400);
  assert.equal((await post({ action: 'archive', kind: 'document', id: 'd2', version: 'stale' })).status, 409);
  assert.equal((await post({ action: 'archive', kind: 'document', id: 'd2', version: before })).status, 200);
  const archivedData = JSON.parse(database.prepare('SELECT data FROM records WHERE id=?').get('d2').data);
  assert(archivedData.archivedAt);
  const docBody = {
    title: 'x',
    category: 'Titoli e SCIA',
    expires: '',
    issued: '',
    vat: '',
    address: '',
    notes: '',
    fileId: '',
    fileName: '',
    reviewed: false,
    reviewer: '',
    protocol: '',
  };
  assert.equal(
    (await post({ action: 'update', kind: 'document', id: 'd2', version: d2v(), data: docBody })).status,
    409,
  );
  r = await portal.POST(req('/api/portal', { action: 'start', portal: p }, ''));
  const cookie3 = r.headers.get('set-cookie').split(';')[0];
  const visit3 = (await r.json()).visit.id;
  assert.equal(
    (await portal.POST(req('/api/portal', { action: 'identify', data: identity }, cookie3))).status,
    200,
  );
  owner();
  assert.equal(
    (
      await room.POST(
        req('/api/control-room', {
          action: 'grants',
          visitId: visit3,
          identityVerified: true,
          documentIds: ['d2'],
        }),
      )
    ).status,
    400,
  );
  // Incremental sync returns the archived record (changed) and a cursor.
  const full = (await json(await state.GET(req('/api/state')))).data;
  const delta = (
    await json(await state.GET(req('/api/state?since=' + encodeURIComponent(archivedData.archivedAt))))
  ).data;
  assert(
    delta.partial && delta.records.some(x => x.id === 'd2') && delta.records.length < full.records.length,
  );
  assert.equal((await state.GET(req('/api/state?since=yesterday'))).status, 400);
  assert.equal((await post({ action: 'restore', kind: 'document', id: 'd2', version: d2v() })).status, 200);
  assert(!JSON.parse(database.prepare('SELECT data FROM records WHERE id=?').get('d2').data).archivedAt);
  passed++;
  // Collaborator: documents and actions only; inspections, events, audio and room stay owner-only.
  globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
  const staffKinds = (await json(await state.GET(req('/api/state?revisions=1')))).data.records.map(
    r => r.kind,
  );
  assert(
    staffKinds.includes('document') && !staffKinds.some(k => ['inspection', 'event', 'revision'].includes(k)),
  );
  assert.equal(
    (
      await post({
        action: 'create',
        kind: 'event',
        data: { inspectionId: inspectionId, speaker: '', text: 'x', tag: 'Nota', offset: 0 },
      })
    ).status,
    403,
  );
  assert.equal((await post({ action: 'profile', data: {} })).status, 403);
  assert.equal(
    (await post({ action: 'archive', kind: 'inspection', id: inspectionId, version: 'x' })).status,
    403,
  );
  assert.equal(
    (
      await post({
        action: 'create',
        kind: 'task',
        data: { title: 'Reperire planimetria', responsible: '', due: '', notes: '', done: false },
      })
    ).status,
    200,
  );
  database
    .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
    .run('faudio', 'owner-id', 'a.webm', 'audio/webm', 'objaudio', 'h', now);
  bucket.set('objaudio', 'AUDIO');
  assert.equal((await privateFile.GET(req('/api/files?id=faudio'))).status, 404);
  assert.equal((await privateFile.GET(req('/api/files?id=fd1'))).status, 200);
  assert.equal((await room.GET()).status, 401);
  assert.equal(
    (await ai.POST(req('/api/assistant', { action: 'transcribe', inspectionId, eventId: 'x' }))).status,
    401,
  );
  owner();
  assert.equal((await privateFile.GET(req('/api/files?id=faudio'))).status, 200);
  passed++;
  // Automatic exhibition: pre-approved documents searchable at once, with synonyms; others stay hidden.
  owner();
  database.prepare('INSERT INTO portal_settings VALUES(?,?,?)').run('owner-id', 1, now);
  database
    .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .run(
      'd3',
      'owner-id',
      'document',
      JSON.stringify({ title: 'SCIA automatica', category: 'Titoli e SCIA', fileId: 'fd3', autoShare: true }),
      now,
      now,
    );
  database
    .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
    .run('fd3', 'owner-id', 'scia.pdf', 'application/pdf', 'objd3', 'hash-d3', now);
  r = await portal.POST(req('/api/portal', { action: 'start', portal: p }, ''));
  const autoCookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await portal.POST(req('/api/portal', { action: 'identify', data: identity }, autoCookie))).status,
    200,
  );
  const autoVisit = database
    .prepare('SELECT status,inspection_id FROM visits ORDER BY created DESC LIMIT 1')
    .get();
  assert.equal(autoVisit.status, 'autorizzata');
  assert(autoVisit.inspection_id);
  x = await json(
    await portal.POST(
      req('/api/portal', { action: 'search', query: 'segnalazione certificata' }, autoCookie),
    ),
  );
  assert.deepEqual(
    x.data.documents.map(d => d.id),
    ['d3'],
  );
  x = await json(await portal.POST(req('/api/portal', { action: 'search', query: 'haccp' }, autoCookie)));
  assert.deepEqual(x.data.documents, []);
  assert.equal(
    database
      .prepare(
        "SELECT json_extract(data,'$.auto') AS auto FROM portal_events WHERE kind='autorizzazione' ORDER BY created DESC LIMIT 1",
      )
      .get().auto,
    1,
  );
  passed++;
  // Live inspection with a simulated OpenAI: segment → transcript → hint; finish → report → archived PDF.
  owner();
  const env = globalThis.__presidioTest.env;
  env.OPENAI_API_KEY = 'sk-test';
  const realFetch = globalThis.fetch;
  const said = 'Mi faccia vedere la SCIA. Se non la trovo le chiudo il locale oggi stesso.';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/audio/transcriptions')) return Response.json({ text: said });
    if (String(url).includes('/responses')) {
      const body = JSON.parse(init.body);
      const out = body.instructions.includes('rapporto finale')
        ? {
            motivo: 'Verifica della SCIA',
            sintesi: 'Richiesta della SCIA con minaccia di chiusura.',
            possibiliViolazioni: [
              {
                titolo: 'Minaccia di chiusura',
                descrizione: 'Prospettata senza provvedimento.',
                citazione: 'le chiudo il locale oggi stesso',
                riferimento: '',
                gravita: 'alta',
                verifica: 'Ascoltare',
              },
              { titolo: 'Inventata', descrizione: 'x', citazione: 'frase mai detta', gravita: 'alta' },
            ],
            azioni: ['Chiedere copia del verbale'],
          }
        : {
            question: 'Mi faccia vedere la SCIA',
            answer: 'Certo, è nel portale: cerchi “scia”.',
            documents: ['d3', 'fantasma'],
            searchHint: 'scia',
            caution: '',
            urgency: 'alta',
          };
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }] });
    }
    return realFetch(url, init);
  };
  try {
    const created = await json(
      await post({
        action: 'create',
        kind: 'inspection',
        data: {
          authority: 'Polizia municipale',
          scope: 'SCIA',
          officers: '',
          reference: '',
          status: 'aperto',
          outcome: '',
          started: now,
          ended: '',
        },
      }),
    );
    const liveId = created.data.id;
    const segment = (n, insp = liveId) => {
      const form = new FormData();
      form.append('inspectionId', insp);
      form.append('seq', String(n));
      form.append('offsetMs', String(n * 8000));
      form.append('file', new File([new Uint8Array(4000)], 'segmento.webm', { type: 'audio/webm' }));
      return liveApi.POST(
        new Request(origin + '/api/live', { method: 'POST', headers: { Origin: origin }, body: form }),
      );
    };
    x = await json(await segment(0));
    assert.equal(x.status, 200);
    assert.equal(x.data.segment.text, said);
    assert.deepEqual(x.data.hint.documents, ['d3']);
    const fin = await json(
      await liveApi.POST(
        new Request(origin + '/api/live', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inspectionId: liveId }),
        }),
      ),
    );
    assert.equal(fin.status, 200);
    assert(fin.data.reportId && fin.data.pdfFileId);
    const rep = JSON.parse(
      database.prepare('SELECT data FROM records WHERE id=?').get(fin.data.reportId).data,
    );
    assert.equal(rep.possibiliViolazioni[0].citazione, 'le chiudo il locale oggi stesso');
    assert.equal(rep.possibiliViolazioni[1].gravita, 'bassa');
    assert.equal(rep.citazioniScartate, 1);
    const pdfRow = database
      .prepare('SELECT object_key,sha256,mime FROM files WHERE id=?')
      .get(fin.data.pdfFileId);
    assert.equal(pdfRow.mime, 'application/pdf');
    assert(bucket.get(pdfRow.object_key).startsWith('%PDF-1.4'));
    assert.equal(
      JSON.parse(database.prepare('SELECT data FROM records WHERE id=?').get(liveId).data).status,
      'concluso',
    );
    assert.equal((await segment(1)).status, 409);
    globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
    assert.equal((await segment(2)).status, 401);
    owner();
  } finally {
    globalThis.fetch = realFetch;
    delete env.OPENAI_API_KEY;
  }
  passed++;
  const { catalogue, catalogueCategories } = await mod('lib/catalogue');
  assert.equal(new Set(catalogue.map(c => c.id)).size, catalogue.length);
  assert(catalogue.every(c => c.title && c.condition && c.description && c.source));
  console.log(`Catalogue: ${catalogue.length} entries / ${catalogueCategories.length} categories`);
  console.log(`PASS ${passed} access-control and lifecycle checks`);
} finally {
  database.close();
  rmSync(dir, { recursive: true, force: true });
}
