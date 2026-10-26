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
      delete: async key => void bucket.delete(key),
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
  'lib/holding.ts',
  'app/api/state/route.ts',
  'app/api/files/route.ts',
  'app/api/portal/route.ts',
  'app/api/portal/file/route.ts',
  'app/api/control-room/route.ts',
  'app/api/assistant/route.ts',
  'lib/live.ts',
  'lib/text-pdf.ts',
  'app/api/live/route.ts',
  'lib/integration.ts',
  'lib/holding-staff.ts',
  'lib/catalogue-matching.ts',
  'lib/inspection-catalogue.ts',
  'lib/catalogue-index.ts',
  'lib/version.ts',
  'lib/holding-alert.ts',
  'app/api/diagnostica/route.ts',
  'lib/staff.ts',
  'lib/reminders.ts',
  'app/api/collegamenti/route.ts',
  'app/api/holding/v1/stato/route.ts',
  'app/api/holding/v1/documenti/route.ts',
  'app/api/holding/v1/file/route.ts',
  'app/api/holding/v1/dipendenti/route.ts',
  'app/api/holding/v1/proposte/route.ts',
  'lib/news.ts',
  'lib/news-job.ts',
  'app/api/novita/route.ts',
  'lib/retention.ts',
  'lib/portal-notice.ts',
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
  liveApi = await mod('app/api/live/route'),
  links = await mod('app/api/collegamenti/route'),
  hStato = await mod('app/api/holding/v1/stato/route'),
  hDocs = await mod('app/api/holding/v1/documenti/route'),
  hFile = await mod('app/api/holding/v1/file/route'),
  hStaff = await mod('app/api/holding/v1/dipendenti/route'),
  hProp = await mod('app/api/holding/v1/proposte/route'),
  novita = await mod('app/api/novita/route');
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
    plate: 'AB123CD',
    noticeRead: true,
  };
  // The plate is no longer asked (minimisation): a stale client sending it gets it dropped.
  // The owner's phone rings through Gionti Holding: the full signal at once, with an «allerta»
  // carrying the office and the declared subject only.
  const henv = globalThis.__presidioTest.env;
  database.prepare("INSERT OR REPLACE INTO admin_identity(slot,owner) VALUES(1,'owner-id')").run();
  henv.HOLDING_SEGNALE_KEY = 'kosw_allerta';
  henv.HOLDING_URL = 'https://centrale.test/api/holding/segnale';
  const fetchBeforeAlert = globalThis.fetch;
  const alerts = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== henv.HOLDING_URL) return fetchBeforeAlert(url, init);
    alerts.push({ auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return Response.json({ ok: true });
  };
  try {
    assert.equal((await portal.POST(req('/api/portal', { action: 'identify', data: identity }))).status, 200);
  } finally {
    globalThis.fetch = fetchBeforeAlert;
    delete henv.HOLDING_SEGNALE_KEY;
    delete henv.HOLDING_URL;
  }
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].auth, 'Bearer kosw_allerta');
  const allerta = alerts[0].body.dati.allerta;
  assert.deepEqual(
    [allerta.tipo, allerta.id, allerta.ente, allerta.motivo, allerta.link],
    ['controllo', visit, 'Ufficio', 'Controllo test', origin + '/'],
  );
  assert.equal(alerts[0].body.stato, 'attenzione');
  assert.match(alerts[0].body.testo, /^controllo in corso: Ufficio · /);
  assert(!/Cognome|Ruolo|AB123CD/.test(JSON.stringify(alerts[0].body)));
  assert(!database.prepare('SELECT data FROM visits WHERE id=?').get(visit).data.includes('AB123CD'));
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
  // Holding interchange: keys with scopes, proposals confirmed by the owner, nothing else writes.
  owner();
  const linkPost = body => links.POST(req('/api/collegamenti', body));
  const created = await json(
    await linkPost({
      action: 'create-key',
      name: 'Gionti Suite',
      scopes: ['documenti:leggi', 'dipendenti:leggi', 'proposte:scrivi'],
    }),
  );
  assert.equal(created.status, 200);
  const keyToken = created.data.token;
  assert.match(keyToken, /^blk_[A-Za-z0-9_-]{43}$/);
  assert(!JSON.stringify(database.prepare('SELECT * FROM integration_keys').all()).includes(keyToken));
  const hreq = (path, init = {}) =>
    new Request(origin + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + keyToken, ...(init.headers || {}) },
    });
  assert.equal((await hStato.GET(new Request(origin + '/api/holding/v1/stato'))).status, 401);
  x = await json(await hStato.GET(hreq('/api/holding/v1/stato')));
  assert.equal(x.data.software, 'blindo-service');
  x = await json(await hDocs.GET(hreq('/api/holding/v1/documenti')));
  assert(x.data.documenti.some(d => d.id === 'd3') && !JSON.stringify(x.data).includes('PRIVATE_INTERNAL'));
  assert.equal((await hFile.GET(hreq('/api/holding/v1/file?documento=d3'))).status, 403); // no file:leggi
  // Proposals: an employee and a document with its file, linked by the external id.
  const propose = (tipo, chiave, dati, file) => {
    if (!file)
      return hProp.POST(
        hreq('/api/holding/v1/proposte', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo, chiaveEsterna: chiave, dati }),
        }),
      );
    const form = new FormData();
    form.append('tipo', tipo);
    form.append('chiaveEsterna', chiave);
    form.append('dati', JSON.stringify(dati));
    form.append('file', file);
    return hProp.POST(hreq('/api/holding/v1/proposte', { method: 'POST', body: form }));
  };
  assert.equal((await propose('dipendente', 'op-7', { name: 'Mario Prova', role: 'Cameriere' })).status, 201);
  assert.equal((await propose('dipendente', 'op-7', { name: 'Mario Prova', role: 'Caposala' })).status, 200); // update, no duplicate
  assert.equal(
    (
      await propose(
        'documento',
        'att-1',
        {
          title: 'Attestato HACCP Mario Prova',
          category: 'Personale e formazione',
          expires: '2029-01-01',
          employeeExternalId: 'op-7',
        },
        new File(['%PDF-1.4 x'], 'att.pdf', { type: 'application/pdf' }),
      )
    ).status,
    201,
  );
  assert.equal(
    (await propose('documento', 'bad', { title: 'x' }, new File(['x'], 'a.webm', { type: 'audio/webm' })))
      .status,
    400,
  );
  assert.equal(database.prepare('SELECT count(*) AS n FROM integration_inbox').get().n, 2);
  assert.equal(database.prepare("SELECT count(*) AS n FROM records WHERE kind='employee'").get().n, 0); // nothing enters without consent
  x = await json(await links.GET());
  const empProp = x.data.inbox.find(i => i.kind === 'dipendente');
  const docProp = x.data.inbox.find(i => i.kind === 'documento');
  assert.equal(empProp.data.role, 'Caposala');
  assert.equal((await linkPost({ action: 'accept', id: empProp.id })).status, 200);
  assert.equal((await linkPost({ action: 'accept', id: docProp.id })).status, 200);
  assert.equal((await linkPost({ action: 'accept', id: docProp.id })).status, 404);
  const emp = database.prepare("SELECT id,data FROM records WHERE kind='employee'").get();
  const att = JSON.parse(
    database
      .prepare(
        "SELECT data FROM records WHERE kind='document' AND json_extract(data,'$.title')='Attestato HACCP Mario Prova'",
      )
      .get().data,
  );
  assert.equal(att.employeeId, emp.id);
  assert.match(att.notes, /Ricevuto da Gionti Suite/);
  // Same data again (the daily resend): nothing changes, the accepted proposal stays accepted.
  x = await json(await propose('dipendente', 'op-7', { name: 'Mario Prova', role: 'Caposala' }));
  assert.deepEqual([x.status, x.data.invariata, x.data.stato], [200, true, 'accettata']);
  x = await json(
    await propose(
      'documento',
      'att-1',
      {
        title: 'Attestato HACCP Mario Prova',
        category: 'Personale e formazione',
        expires: '2029-01-01',
        employeeExternalId: 'op-7',
      },
      new File(['%PDF-1.4 x'], 'att.pdf', { type: 'application/pdf' }),
    ),
  );
  assert.equal(x.data.invariata, true);
  // Changed data: back to the owner for a new decision.
  x = await json(await propose('dipendente', 'op-7', { name: 'Mario Prova', role: 'Responsabile sala' }));
  assert.deepEqual([x.data.aggiornata, x.data.stato], [true, 'in_attesa']);
  x = await json(await hStaff.GET(hreq('/api/holding/v1/dipendenti')));
  const mario = x.data.dipendenti.find(d => d.name === 'Mario Prova');
  assert.equal(mario.externalId, 'op-7');
  assert(
    mario.missing.includes('Comunicazione UNILAV') &&
      !mario.missing.includes('Attestato alimentarista (HACCP)'),
  );
  // Staff from the centrale (Kassaro OS 8.4.0): proposals «Gionti Suite» with the holding key, an unchanged
  // person is not proposed again, accepting links to the employee the owner entered by hand.
  {
    const { syncStaff } = await mod('lib/holding-staff');
    database.prepare("INSERT OR REPLACE INTO admin_identity(slot,owner) VALUES(1,'owner-id')").run();
    x = await json(
      await state.POST(
        req('/api/state', {
          action: 'create',
          kind: 'employee',
          data: {
            name: 'Faraci Dorotea',
            role: '',
            hired: '',
            contract: 'Tempo indeterminato',
            endDate: '',
            extraUe: false,
            designations: ['RLS'],
            medicalRequired: false,
            active: true,
            notes: 'Scritto dal titolare',
          },
        }),
      ),
    );
    const manualId = x.data.id;
    let staffList = [
      { id: 12, nome: 'Dorotea Faraci', mansione: 'Banconista', reparto: 'Bar', assunto: '2025-03-01' },
      { id: '13', nome: 'Akash Sarkar', mansione: '', reparto: 'Cucina', assunto: 'non valida' },
      { id: '14', nome: '' },
    ];
    let seenAuth = '';
    const centrale = async (url, init) => {
      assert.equal(String(url), 'https://centrale.test/api/holding/operatori');
      seenAuth = init.headers.Authorization;
      return Response.json({ fonte: 'Kassaro OS', operatori: staffList });
    };
    const staffEnv = {
      DB: env.DB,
      HOLDING_SEGNALE_KEY: 'kosw_test',
      HOLDING_URL: 'https://centrale.test/api/holding/segnale',
    };
    assert.equal((await syncStaff({ DB: env.DB }, new Date(), centrale)).ok, false); // no key: nothing read
    x = await syncStaff(staffEnv, new Date(), centrale);
    assert.deepEqual([x.ok, x.persone, x.nuove], [true, 2, 2]);
    assert.equal(seenAuth, 'Bearer kosw_test');
    assert.equal((await syncStaff(staffEnv, new Date(), centrale)).invariate, 2);
    const inbox = (await json(await links.GET())).data.inbox.filter(i => i.source === 'Gionti Suite');
    const dorotea = inbox.find(i => i.external_key === 'dipendente:12');
    assert.deepEqual(dorotea.data, {
      name: 'Dorotea Faraci',
      role: 'Banconista',
      hired: '2025-03-01',
      contract: '',
      endDate: '',
      active: true,
    });
    assert.equal(inbox.find(i => i.external_key === 'dipendente:13').data.role, 'Cucina');
    assert.equal(inbox.find(i => i.external_key === 'dipendente:13').data.hired, '');
    assert.equal((await linkPost({ action: 'accept', id: dorotea.id })).status, 200);
    const linked = JSON.parse(database.prepare('SELECT data FROM records WHERE id=?').get(manualId).data);
    assert.deepEqual(
      [linked.name, linked.role, linked.contract, linked.designations, linked.externalId, linked.notes],
      ['Faraci Dorotea', 'Banconista', 'Tempo indeterminato', ['RLS'], '12', 'Scritto dal titolare'],
    );
    assert.equal(
      database
        .prepare(
          "SELECT count(*) AS n FROM records WHERE kind='employee' AND json_extract(data,'$.name') LIKE '%Dorotea%'",
        )
        .get().n,
      1,
    );
    // Accepted and unchanged: it stays accepted. Changed in the management software: back to the owner.
    assert.equal((await syncStaff(staffEnv, new Date(), centrale)).invariate, 2);
    staffList = [{ ...staffList[0], mansione: 'Caposala' }, staffList[1]];
    x = await syncStaff(staffEnv, new Date(), centrale);
    assert.deepEqual([x.aggiornate, x.invariate], [1, 1]);
    assert.equal(
      database.prepare("SELECT status FROM integration_inbox WHERE external_key='dipendente:12'").get()
        .status,
      'in_attesa',
    );
    x = await syncStaff(staffEnv, new Date(), async () => new Response('no', { status: 403 }));
    assert.deepEqual([x.ok, x.status], [false, 403]);
  }
  // Collaborator cannot manage keys; revoked key stops working.
  globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
  assert.equal((await links.GET()).status, 401);
  owner();
  const keyId = database.prepare('SELECT id FROM integration_keys').get().id;
  assert.equal((await linkPost({ action: 'revoke-key', id: keyId })).status, 200);
  assert.equal((await hDocs.GET(hreq('/api/holding/v1/documenti'))).status, 401);
  passed++;
  // News: web search answer filtered to allowed sources, owner-only refresh, token for the weekly job.
  owner();
  env.OPENAI_API_KEY = 'sk-test';
  const fetchBefore = globalThis.fetch;
  let toolsSeen = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/responses')) {
      toolsSeen = JSON.parse(init.body).tools;
      const out = {
        notizie: [
          {
            titolo: 'Ordinanza orari movida',
            fonte: 'Comune di Palermo',
            url: 'https://www.comune.palermo.it/o/1',
            sintesi: 'Nuovi orari',
            rilevanza: 'alta',
          },
          { titolo: 'Notizia falsa', fonte: 'Blog', url: 'https://example.com/x', sintesi: 'x' },
        ],
      };
      return Response.json({
        output: [{ content: [{ type: 'output_text', text: 'Ecco: ' + JSON.stringify(out) }] }],
      });
    }
    return fetchBefore(url, init);
  };
  try {
    const nreq = body => novita.POST(req('/api/novita', body));
    x = await json(await nreq({ action: 'aggiorna' }));
    assert.equal(x.status, 200);
    assert.deepEqual([x.data.nuove, x.data.scartate], [1, 1]);
    // The search itself is limited to the allowed sites (parseNews still checks every link).
    assert.equal(toolsSeen[0].type, 'web_search');
    assert(toolsSeen[0].filters.allowed_domains.includes('fipe.it'));
    assert(toolsSeen[0].filters.allowed_domains.includes('comune.palermo.it'));
    x = await json(await nreq({ action: 'aggiorna' }));
    assert.equal(x.data.nuove, 0); // same URL is not stored twice
    const list = await json(await novita.GET());
    assert.equal(list.data.items.length, 1);
    assert.equal((await nreq({ action: 'stato', id: list.data.items[0].id, stato: 'letta' })).status, 200);
    globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
    assert.equal((await nreq({ action: 'aggiorna' })).status, 401);
    assert.equal((await novita.GET()).status, 200);
    owner();
    // The old GitHub job (Bearer token, no session) is gone: the weekly search runs from the Cron.
    const job = await novita.POST(
      new Request(origin + '/api/novita', {
        method: 'POST',
        headers: { Authorization: 'Bearer x'.repeat(8) },
      }),
    );
    assert.equal(job.status, 403);
    // Cron: the manual search above counts as this week's run; next Monday from 08:00 (Rome) it runs.
    const { runNews } = await mod('lib/news-job');
    await env.DB.prepare("INSERT OR REPLACE INTO admin_identity(slot,owner) VALUES(1,'owner-id')").run();
    const runAt = iso => runNews(env, new Date(iso));
    const thisWeek = new Date();
    assert.equal((await runAt(thisWeek.toISOString())).saltata, 'non è il momento');
    const monday = new Date(thisWeek);
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    const day = monday.toISOString().slice(0, 10);
    assert.equal((await runAt(day + 'T05:30:00Z')).saltata, 'non è il momento'); // 06:30 or 07:30 in Rome
    x = await runAt(day + 'T07:10:00Z');
    assert.equal(x.ok, true);
    assert.equal(x.nuove, 0); // known URL, not stored twice
    assert.equal((await runAt(day + 'T08:10:00Z')).saltata, 'non è il momento');
    // A failed search is retried after 6 hours, not every hour.
    const next = new Date(Date.parse(day) + 7 * 86_400_000).toISOString().slice(0, 10);
    const okFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('down', { status: 500 });
    assert.equal((await runAt(next + 'T07:10:00Z')).ok, false);
    globalThis.fetch = okFetch;
    assert.equal((await runAt(next + 'T09:10:00Z')).saltata, 'non è il momento');
    assert.equal((await runAt(next + 'T13:20:00Z')).ok, true);
    delete env.OPENAI_API_KEY;
    assert.equal((await runAt(next + 'T13:20:00Z')).saltata, 'IA non collegata');
  } finally {
    globalThis.fetch = fetchBefore;
    delete env.OPENAI_API_KEY;
  }
  passed++;

  // «Prova l'IA»: only the owner; every service of the live inspection tried; the result (not the
  // microphone-only test) is kept for the readiness guide; errors in plain words.
  {
    const diag = await mod('app/api/diagnostica/route');
    const sample = (solo = '') => {
      const f = new FormData();
      f.append('audio', new File(['fake-audio'], 'prova.m4a', { type: 'audio/mp4' }));
      if (solo) f.append('solo', solo);
      return f;
    };
    const dreq = form =>
      diag.POST(
        new Request(origin + '/api/diagnostica', { method: 'POST', headers: { Origin: origin }, body: form }),
      );
    const saved = () =>
      JSON.parse(database.prepare("SELECT data FROM records WHERE kind='ai_check'").get().data);
    owner();
    assert.equal((await dreq(sample())).status, 503); // no OpenAI key
    env.OPENAI_API_KEY = 'sk-test';
    const seen = [];
    const fetchBeforeDiag = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/v1/audio/transcriptions'))
        return Response.json({ text: 'Buongiorno, prova di Blindo Service' });
      if (!u.endsWith('/v1/responses')) return fetchBeforeDiag(url, init);
      const b = JSON.parse(init.body);
      seen.push(b);
      const text = b.tools ? 'Trovato: {"url":"https://www.comune.palermo.it/"}' : '{"pronto":true}';
      return Response.json({ output: [{ content: [{ type: 'output_text', text }] }] });
    };
    try {
      x = await json(await dreq(sample()));
      assert.deepEqual([x.status, x.data.ok, x.data.checks.length], [200, true, 4]);
      assert.deepEqual(
        seen.map(b => b.model),
        ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1'],
      );
      assert(seen[2].tools[0].filters.allowed_domains.includes('comune.palermo.it'));
      assert.deepEqual(x.data.avvisi, { holding: false, telegram: false, email: false });
      assert.equal(saved().ok, true);
      // A model the key cannot use: said in plain words.
      globalThis.fetch = async url =>
        String(url).endsWith('/v1/responses')
          ? new Response('{}', { status: 404 })
          : Response.json({ text: 'Buongiorno prova' });
      x = await json(await dreq(sample()));
      assert.equal(x.data.ok, false);
      assert.equal(x.data.checks[1].esito, 'Il modello non è disponibile per questa chiave');
      assert.equal(saved().ok, false);
      // Microphone only: transcription alone, and the readiness check is not overwritten.
      x = await json(await dreq(sample('microfono')));
      assert.deepEqual([x.data.ok, x.data.checks.length], [true, 1]);
      assert.equal(saved().ok, false);
      globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
      assert.equal((await dreq(sample())).status, 401);
      owner();
    } finally {
      globalThis.fetch = fetchBeforeDiag;
      delete env.OPENAI_API_KEY;
    }
    const { VERSION } = await mod('lib/version');
    assert.equal(VERSION, JSON.parse(readFileSync('package.json', 'utf8')).version);
  }
  passed++;

  // ── Data retention (documento 10 «Conservazione») ─────────────────────────────────────────
  const staffUser = () => {
    globalThis.__presidioTest.user = { userId: 'owner-id', email: 'staff@example.test' };
  };
  const keep = body => state.POST(req('/api/state', body));
  owner();
  x = await json(
    await keep({
      action: 'create',
      kind: 'inspection',
      data: {
        authority: 'Polizia Municipale',
        scope: 'Dehors',
        officers: 'Agente RETENTION_NAME',
        reference: '',
        status: 'aperto',
        outcome: '',
        started: '2026-01-10T09:00:00.000Z',
        ended: '',
      },
    }),
  );
  const ri = x.data.id;
  const rowOf = id => database.prepare('SELECT data,updated FROM records WHERE id=?').get(id);
  let row = rowOf(ri);
  staffUser();
  assert.equal(
    (
      await keep({
        action: 'procedimento',
        id: ri,
        version: row.updated,
        open: true,
        hold: { dal: '', riferimento: '', nota: '' },
      })
    ).status,
    403,
  );
  owner();
  assert.equal(
    (
      await keep({
        action: 'procedimento',
        id: ri,
        version: row.updated,
        open: true,
        hold: { dal: '2026-02-01', riferimento: 'Verbale 7/2026', nota: '' },
      })
    ).status,
    200,
  );
  row = rowOf(ri);
  assert.equal(JSON.parse(row.data).procedimento.riferimento, 'Verbale 7/2026');
  // An edit from the form (which never carries the retention fields) keeps the hold.
  await new Promise(r => setTimeout(r, 2));
  assert.equal(
    (
      await keep({
        action: 'update',
        kind: 'inspection',
        id: ri,
        version: row.updated,
        data: { ...JSON.parse(row.data), procedimento: undefined, outcome: 'Verbale notificato' },
      })
    ).status,
    200,
  );
  row = rowOf(ri);
  assert.equal(JSON.parse(row.data).procedimento.riferimento, 'Verbale 7/2026');
  assert.equal(JSON.parse(row.data).outcome, 'Verbale notificato');
  await new Promise(r => setTimeout(r, 2));
  assert.equal(
    (await keep({ action: 'procedimento', id: ri, version: row.updated, open: false })).status,
    200,
  );
  row = rowOf(ri);
  assert(JSON.parse(row.data).procedimentoChiuso);
  // Closing twice is refused.
  assert.equal(
    (await keep({ action: 'procedimento', id: ri, version: row.updated, open: false })).status,
    409,
  );
  passed++;

  // Listening log: one row per audio file every 10 minutes, owner only.
  database
    .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
    .run('raudio', 'owner-id', 'controllo.webm', 'audio/webm', 'obj-raudio', 'h', now);
  bucket.set('obj-raudio', 'audio-bytes');
  database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(
    'revent',
    'owner-id',
    'event',
    JSON.stringify({
      inspectionId: ri,
      speaker: '',
      text: 'Audio',
      tag: 'Registrazione',
      offset: 0,
      fileId: 'raudio',
    }),
    now,
    now,
  );
  assert.equal((await privateFile.GET(req('/api/files?id=raudio'))).status, 200);
  assert.equal((await privateFile.GET(req('/api/files?id=raudio'))).status, 200);
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS n FROM records WHERE kind='ascolto' AND json_extract(data,'$.fileId')='raudio'",
      )
      .get().n,
    1,
  );
  staffUser();
  assert.equal((await privateFile.GET(req('/api/files?id=raudio'))).status, 404);
  passed++;

  // Former employees: deletion only after the term, confirmed by the owner, never by the collaborator.
  owner();
  x = await json(
    await keep({
      action: 'create',
      kind: 'employee',
      data: {
        name: 'Ex Dipendente',
        role: '',
        hired: '',
        contract: '',
        endDate: '',
        extraUe: false,
        designations: [],
        medicalRequired: false,
        active: true,
        notes: '',
      },
    }),
  );
  const empId = x.data.id;
  database
    .prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
    .run('fid', 'owner-id', 'ci.pdf', 'application/pdf', 'obj-fid', 'h', now);
  bucket.set('obj-fid', '%PDF-id');
  database
    .prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
    .run(
      'docid',
      'owner-id',
      'document',
      JSON.stringify({ title: 'Documento di identità – Ex Dipendente', fileId: 'fid', employeeId: empId }),
      now,
      now,
    );
  assert.equal((await keep({ action: 'purge', kind: 'document', id: 'docid', version: now })).status, 409);
  let exEmp = rowOf(empId);
  await new Promise(r => setTimeout(r, 2));
  assert.equal(
    (
      await keep({
        action: 'update',
        kind: 'employee',
        id: empId,
        version: exEmp.updated,
        data: { ...JSON.parse(exEmp.data), active: false, endDate: '2020-01-31' },
      })
    ).status,
    200,
  );
  staffUser();
  assert.equal((await keep({ action: 'purge', kind: 'document', id: 'docid', version: now })).status, 403);
  owner();
  exEmp = rowOf(empId);
  assert.equal(
    (await keep({ action: 'purge', kind: 'employee', id: empId, version: exEmp.updated })).status,
    409,
  );
  assert.equal((await keep({ action: 'purge', kind: 'document', id: 'docid', version: now })).status, 200);
  assert.equal(rowOf('docid'), undefined);
  assert(!bucket.has('obj-fid'));
  assert.equal(database.prepare("SELECT count(*) AS n FROM files WHERE id='fid'").get().n, 0);
  assert.equal(
    (await keep({ action: 'purge', kind: 'employee', id: empId, version: exEmp.updated })).status,
    200,
  );
  passed++;

  // After any deletion an incremental sync becomes a full reload, once.
  x = await json(await state.GET(req('/api/state?since=2026-01-01T00:00:00.000Z')));
  assert.equal(x.data.partial, false);
  const cursorAfter = x.data.cursor;
  x = await json(await state.GET(req('/api/state?since=' + cursorAfter)));
  assert.equal(x.data.partial, true);
  passed++;

  // Access request of an officer: portal data only, no internal notes.
  x = await json(
    await room.POST(req('/api/control-room', { action: 'report', visitId: visit, scope: 'interessato' })),
  );
  assert.equal(x.status, 200);
  assert.match(x.data.text, /art\. 15/);
  assert.match(x.data.text, /Nome Cognome/);
  assert(!x.data.text.includes('ANNOTAZIONI'));
  assert(!x.data.text.includes('AB123CD'));
  passed++;

  // Nightly run: 30 days after «procedimento chiuso» the inspection loses its personal data.
  const { runRetention } = await mod('lib/retention');
  const far = new Date(Date.now() + 31 * 86_400_000);
  const run = await runRetention(env, far, true);
  assert.equal(run.ok, true);
  const anonData = JSON.parse(rowOf(ri).data);
  assert.equal(anonData.officers, '');
  assert(anonData.anonimizzato);
  assert.equal(rowOf('revent'), undefined);
  assert(!bucket.has('obj-raudio'));
  assert(!JSON.stringify(database.prepare('SELECT data FROM records').all()).includes('RETENTION_NAME'));
  assert(bucket.has('objd1')); // archive documents are never touched
  passed++;

  // Portal notice: the template markers block the activation.
  database.prepare('UPDATE profiles SET data=? WHERE owner=?').run(
    JSON.stringify({
      name: 'Test company',
      portalNotice: 'Informativa [DA COMPLETARE: email] '.repeat(10),
    }),
    'owner-id',
  );
  x = await json(await room.POST(req('/api/control-room', { action: 'portal', enabled: true })));
  assert.equal(x.status, 400);
  assert.match(x.data.error, /DA COMPLETARE/);
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
