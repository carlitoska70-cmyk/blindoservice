// Framework-independent durable queue. All mutations remain scoped to the operator.
type Deps = {
  authorize: () => Promise<{ userId: string; displayName?: string } | null>;
  db: any;
  recognize: (req: Request) => Promise<Response>;
  decide: (recognition: any, profile: any) => { ids: string[]; candidates: any[]; reasons: string[] };
  link: (data: any, ids: string[]) => any;
  validIds: (ids: string[]) => boolean;
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const now = () => new Date().toISOString();
const states = [
  'queued',
  'processing',
  'review',
  'applied',
  'skipped',
  'error',
  'conflict',
  'rejected',
  'undone',
];
const parse = (v: string, fallback: any = {}) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const schemas = [
  `CREATE TABLE IF NOT EXISTS catalogue_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,created TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS catalogue_jobs_active ON catalogue_jobs(owner) WHERE active=1`,
  `CREATE TABLE IF NOT EXISTS catalogue_items(id TEXT PRIMARY KEY,job TEXT NOT NULL,owner TEXT NOT NULL,document_id TEXT NOT NULL,document_version TEXT NOT NULL,file_id TEXT NOT NULL,title TEXT NOT NULL,file_name TEXT NOT NULL,status TEXT NOT NULL,lease INTEGER NOT NULL DEFAULT 0,token TEXT NOT NULL DEFAULT '',analysis TEXT NOT NULL DEFAULT '{}',reason TEXT NOT NULL DEFAULT '',added TEXT NOT NULL DEFAULT '[]',applied_version TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS catalogue_items_queue ON catalogue_items(owner,job,status,document_id)`,
];
async function requestBody(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 12000) throw new Error('Richiesta troppo grande');
  if (!req.body) return {};
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let n = 0,
    text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > 12000) {
        await reader.cancel();
        throw new Error('Richiesta troppo grande');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export async function handleCatalogueBatch(req: Request, deps: Deps) {
  try {
    const user = await deps.authorize();
    if (!user) return json({ error: 'Accesso richiesto' }, 401);
    const url = new URL(req.url);
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);
    if (req.method === 'POST' && req.headers.get('origin') !== url.origin)
      return json({ error: 'Origine non valida' }, 403);
    const db = deps.db;
    if (!db) return json({ error: 'Archivio non disponibile' }, 503);
    for (const sql of schemas) await db.prepare(sql).run();
    const owner = user.userId,
      actor = user.displayName || user.userId,
      b = req.method === 'POST' ? await requestBody(req) : {};
    const first = (sql: string, ...args: any[]) =>
      db
        .prepare(sql)
        .bind(...args)
        .first();
    const run = (sql: string, ...args: any[]) =>
      db
        .prepare(sql)
        .bind(...args)
        .run();
    async function finish(job: string) {
      await run(
        "UPDATE catalogue_jobs SET active=0 WHERE id=? AND owner=? AND NOT EXISTS(SELECT 1 FROM catalogue_items WHERE job=? AND owner=? AND status IN ('queued','processing'))",
        job,
        owner,
        job,
        owner,
      );
    }
    if (req.method === 'POST' && b.action === 'start') {
      if (b.confirm !== true) return json({ error: 'Conferma la rilettura degli originali.' }, 400);
      const id = crypto.randomUUID(),
        at = now();
      await db.batch([
        db
          .prepare(
            'INSERT INTO catalogue_jobs(id,owner,created) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM catalogue_jobs WHERE owner=? AND active=1)',
          )
          .bind(id, owner, at, owner),
        db
          .prepare(
            `INSERT INTO catalogue_items(id,job,owner,document_id,document_version,file_id,title,file_name,status,reason,updated)
    SELECT ?||':'||r.id,?,r.owner,r.id,r.updated,COALESCE(json_extract(r.data,'$.fileId'),''),COALESCE(json_extract(r.data,'$.title'),''),COALESCE(json_extract(r.data,'$.fileName'),''),CASE WHEN COALESCE(json_extract(r.data,'$.fileId'),'')='' THEN 'skipped' ELSE 'queued' END,CASE WHEN COALESCE(json_extract(r.data,'$.fileId'),'')='' THEN 'Originale assente: carica il file nella scheda.' ELSE '' END,?
    FROM records r WHERE r.owner=? AND r.kind='document' AND EXISTS(SELECT 1 FROM catalogue_jobs WHERE id=? AND owner=?)`,
          )
          .bind(id, id, at, owner, id, owner),
      ]);
      const job = await first(
        'SELECT * FROM catalogue_jobs WHERE owner=? AND (active=1 OR id=?) ORDER BY active DESC,created DESC LIMIT 1',
        owner,
        id,
      );
      await finish(job.id);
      return json({ job: job.id });
    }
    const jobId = req.method === 'GET' ? url.searchParams.get('job') : b.job;
    if (jobId && (typeof jobId !== 'string' || jobId.length > 100))
      return json({ error: 'Sessione non valida' }, 400);
    const job = jobId
      ? await first('SELECT * FROM catalogue_jobs WHERE id=? AND owner=?', jobId, owner)
      : await first(
          'SELECT * FROM catalogue_jobs WHERE owner=? ORDER BY active DESC,created DESC,id DESC LIMIT 1',
          owner,
        );
    if (!job)
      return req.method === 'GET' && !jobId
        ? json({ job: null, items: [], counts: {}, jobs: [] })
        : json({ error: 'Sessione non trovata' }, 404);
    if (req.method === 'GET') {
      const offset = Math.floor(Math.max(0, Math.min(10000000, Number(url.searchParams.get('offset')) || 0))),
        limit = Math.floor(Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20)));
      const filter = url.searchParams.get('state') || 'all';
      if (filter !== 'all' && !states.includes(filter)) return json({ error: 'Filtro non valido' }, 400);
      const counts = (
        await db
          .prepare(
            'SELECT status,count(*) count FROM catalogue_items WHERE job=? AND owner=? GROUP BY status',
          )
          .bind(job.id, owner)
          .all()
      ).results;
      const items = (
        await db
          .prepare(
            'SELECT * FROM catalogue_items WHERE job=? AND owner=?' +
              (filter === 'all' ? '' : ' AND status=?') +
              ' ORDER BY document_id LIMIT ? OFFSET ?',
          )
          .bind(job.id, owner, ...(filter === 'all' ? [] : [filter]), limit, offset)
          .all()
      ).results;
      const jobs = (
        await db
          .prepare(
            'SELECT id,created,active FROM catalogue_jobs WHERE owner=? ORDER BY created DESC,id DESC LIMIT 10',
          )
          .bind(owner)
          .all()
      ).results;
      return json({
        job: { id: job.id, created: job.created, active: !!job.active },
        jobs,
        counts: Object.fromEntries(counts.map((c: any) => [c.status, c.count])),
        items: items.map((i: any) => ({
          id: i.id,
          documentId: i.document_id,
          fileId: i.file_id,
          title: i.title,
          fileName: i.file_name,
          status: i.status,
          reason: i.reason,
          analysis: parse(i.analysis),
          added: parse(i.added, []),
          updated: i.updated,
        })),
        offset,
        limit,
      });
    }
    async function claim(item: any, status: string) {
      const token = crypto.randomUUID();
      const r = await run(
        'UPDATE catalogue_items SET status=?,token=?,lease=?,updated=? WHERE id=? AND owner=? AND status=? AND (status<>? OR lease<?)',
        'processing',
        token,
        Date.now() + 120000,
        now(),
        item.id,
        owner,
        status,
        'processing',
        Date.now(),
      );
      return r.meta.changes ? token : null;
    }
    async function mark(item: any, token: string, status: string, reason: string, analysis?: any) {
      await run(
        'UPDATE catalogue_items SET status=?,reason=?,analysis=?,lease=0,updated=? WHERE id=? AND owner=? AND token=? AND status=?',
        status,
        reason,
        JSON.stringify(analysis || parse(item.analysis)),
        now(),
        item.id,
        owner,
        token,
        'processing',
      );
    }
    async function apply(item: any, token: string, ids: string[], mode: string, analysis: any, undo = false) {
      analysis = { ...analysis, decisionMode: mode };
      const doc = await first(
        "SELECT * FROM records WHERE id=? AND owner=? AND kind='document'",
        item.document_id,
        owner,
      );
      const expected = undo ? item.applied_version : item.document_version;
      if (!doc || doc.updated !== expected || parse(doc.data).fileId !== item.file_id) {
        await mark(
          item,
          token,
          'conflict',
          'La scheda è cambiata: rileggi il documento prima di decidere.',
          analysis,
        );
        return 'conflict';
      }
      const old = parse(doc.data),
        next = deps.link(old, ids),
        oldLinks = [...new Set([old.catalogId, ...(old.catalogIds || [])].filter(Boolean))];
      const added = ids.filter(id => !oldLinks.includes(id));
      if (!undo && !added.length) {
        await mark(item, token, 'skipped', 'Collegamenti già presenti. Nessuna modifica.', analysis);
        return 'skipped';
      }
      const at = new Date(Math.max(Date.now(), (Date.parse(doc.updated) || 0) + 1)).toISOString(),
        revision = crypto.randomUUID();
      const guard =
        "EXISTS(SELECT 1 FROM catalogue_items WHERE id=? AND owner=? AND status='processing' AND token=?)";
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated,'catalogueBatch',?,'decision',?,'reviewer',?),?,? FROM records WHERE id=? AND owner=? AND updated=? AND ${guard}`,
          )
          .bind(revision, job.id, mode, actor, at, at, doc.id, owner, expected, item.id, owner, token),
        db
          .prepare(`UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND updated=? AND ${guard}`)
          .bind(JSON.stringify(next), at, doc.id, owner, expected, item.id, owner, token),
        db
          .prepare(
            `UPDATE catalogue_items SET status=?,reason=?,analysis=?,added=?,applied_version=?,lease=0,updated=? WHERE id=? AND owner=? AND token=? AND status='processing' AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND updated=?)`,
          )
          .bind(
            undo ? 'undone' : 'applied',
            undo
              ? 'Collegamenti aggiunti dalla sessione rimossi.'
              : mode === 'automatico'
                ? 'Abbinamento automatico; validità del documento da verificare.'
                : 'Abbinamento confermato dal responsabile.',
            JSON.stringify(analysis),
            JSON.stringify(undo ? parse(item.added, []) : added),
            at,
            at,
            item.id,
            owner,
            token,
            doc.id,
            owner,
            at,
          ),
      ]);
      if (!results[1].meta.changes) {
        await mark(item, token, 'conflict', 'Salvataggio concorrente: rileggi la scheda.', analysis);
        return 'conflict';
      }
      return undo ? 'undone' : 'applied';
    }
    if (b.action === 'step') {
      const item = await first(
        "SELECT * FROM catalogue_items WHERE job=? AND owner=? AND (status='queued' OR (status='processing' AND lease<?)) ORDER BY document_id LIMIT 1",
        job.id,
        owner,
        Date.now(),
      );
      if (!item) {
        await finish(job.id);
        const pending = await first(
          "SELECT count(*) n FROM catalogue_items WHERE job=? AND owner=? AND status IN ('queued','processing')",
          job.id,
          owner,
        );
        return json({ done: pending.n === 0, busy: pending.n > 0 });
      }
      const token = await claim(item, item.status);
      if (!token) return json({ busy: true });
      const doc = await first(
        "SELECT updated,data FROM records WHERE id=? AND owner=? AND kind='document'",
        item.document_id,
        owner,
      );
      if (!doc || doc.updated !== item.document_version || parse(doc.data).fileId !== item.file_id) {
        await mark(item, token, 'conflict', 'Scheda modificata dopo l’avvio: serve una nuova lettura.');
        await finish(job.id);
        return json({ status: 'conflict' });
      }
      let result: any, response: Response;
      try {
        response = await deps.recognize(
          new Request(req.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: url.origin },
            body: JSON.stringify({ fileId: item.file_id }),
          }),
        );
        result = await response.json();
      } catch {
        await mark(item, token, 'error', 'Lettura interrotta. Riprova questo documento.');
        await finish(job.id);
        return json({ status: 'error', stop: true });
      }
      if (!response.ok) {
        await mark(item, token, 'error', String(result.error || 'Lettura non riuscita').slice(0, 500));
        await finish(job.id);
        return json({ status: 'error', stop: [401, 429, 500, 502, 503, 504].includes(response.status) });
      }
      if (result.fileId !== item.file_id || !result.recognition?.fields) {
        await mark(item, token, 'error', 'Risposta non associata all’originale.');
        await finish(job.id);
        return json({ status: 'error', stop: true });
      }
      const p = await first('SELECT data FROM profiles WHERE owner=?', owner);
      const decision = deps.decide(result.recognition, p ? parse(p.data) : {});
      const analysis = {
        recognition: result.recognition,
        candidates: decision.candidates,
        reasons: decision.reasons,
        fileId: item.file_id,
        readAt: now(),
        mode: 'automatico',
      };
      let status = 'review';
      if (decision.ids.length) {
        const old = parse(doc.data),
          ids = [
            ...new Set([old.catalogId, ...(old.catalogIds || []), ...decision.ids].filter(Boolean)),
          ] as string[];
        if (ids.length > 20) {
          analysis.reasons.push('Limite di 20 voci raggiunto.');
          await mark(item, token, 'review', 'Verifica umana richiesta.', analysis);
        } else status = await apply(item, token, ids, 'automatico', analysis);
      } else await mark(item, token, 'review', 'Verifica umana richiesta.', analysis);
      await finish(job.id);
      return json({ status });
    }
    if (typeof b.id !== 'string' || b.id.length > 210)
      return json({ error: 'Documento della sessione non valido' }, 400);
    const item = await first(
      'SELECT * FROM catalogue_items WHERE id=? AND job=? AND owner=?',
      b.id,
      job.id,
      owner,
    );
    if (!item) return json({ error: 'Documento non trovato' }, 404);
    if (b.action === 'retry') {
      if (!['error', 'conflict', 'review'].includes(item.status))
        return json({ error: 'Questo documento non richiede una nuova lettura.' }, 409);
      const other = await first(
        'SELECT id FROM catalogue_jobs WHERE owner=? AND active=1 AND id<>?',
        owner,
        job.id,
      );
      if (other) return json({ error: 'Completa la scansione già in corso prima di riprovare questa.' }, 409);
      const doc = await first(
        "SELECT data,updated FROM records WHERE id=? AND owner=? AND kind='document'",
        item.document_id,
        owner,
      );
      if (!doc || !parse(doc.data).fileId)
        return json({ error: 'Originale non disponibile nella scheda.' }, 409);
      await db.batch([
        db.prepare('UPDATE catalogue_jobs SET active=1 WHERE id=? AND owner=?').bind(job.id, owner),
        db
          .prepare(
            "UPDATE catalogue_items SET status='queued',document_version=?,file_id=?,title=?,file_name=?,reason='',analysis='{}',lease=0,token='',updated=? WHERE id=? AND owner=? AND status=?",
          )
          .bind(
            doc.updated,
            parse(doc.data).fileId,
            String(parse(doc.data).title || ''),
            String(parse(doc.data).fileName || ''),
            now(),
            item.id,
            owner,
            item.status,
          ),
      ]);
      return json({ ok: true });
    }
    if (b.action === 'reject') {
      if (item.status === 'rejected') return json({ ok: true });
      if (item.status !== 'review') return json({ error: 'Proposta non disponibile' }, 409);
      const note = String(b.note || '').trim();
      if (note.length < 3 || note.length > 1000)
        return json({ error: 'Indica un motivo da 3 a 1000 caratteri.' }, 400);
      await run(
        "UPDATE catalogue_items SET status='rejected',reason=?,updated=? WHERE id=? AND owner=? AND status='review'",
        'Non abbinato: ' + note,
        now(),
        item.id,
        owner,
      );
      return json({ ok: true });
    }
    if (b.action === 'approve' || b.action === 'undo') {
      const undo = b.action === 'undo';
      if (item.status === (undo ? 'undone' : 'applied')) return json({ ok: true });
      if (item.status !== (undo ? 'applied' : 'review'))
        return json({ error: 'Lo stato è cambiato. Ricarica la sessione.' }, 409);
      let ids: string[];
      const doc = await first(
          "SELECT data FROM records WHERE id=? AND owner=? AND kind='document'",
          item.document_id,
          owner,
        ),
        data = doc ? parse(doc.data) : {};
      const links = [...new Set([data.catalogId, ...(data.catalogIds || [])].filter(Boolean))] as string[];
      if (undo) {
        ids = links.filter(id => !parse(item.added, []).includes(id));
      } else {
        if (
          !Array.isArray(b.ids) ||
          !b.ids.length ||
          b.ids.length > 20 ||
          !b.ids.every((id: any) => typeof id === 'string' && id.length <= 100) ||
          !deps.validIds(b.ids)
        )
          return json({ error: 'Scegli voci valide del catalogo.' }, 400);
        ids = [...new Set([...links, ...b.ids])] as string[];
        if (ids.length > 20) return json({ error: 'Massimo 20 voci per documento.' }, 400);
      }
      const token = await claim(item, item.status);
      if (!token) return json({ error: 'Operazione già in corso.' }, 409);
      const status = await apply(
        item,
        token,
        ids,
        undo ? 'annullamento' : 'umano',
        { ...parse(item.analysis), decisionAt: now(), reviewer: actor },
        undo,
      );
      await finish(job.id);
      return json({ ok: status !== 'conflict', status }, status === 'conflict' ? 409 : 200);
    }
    return json({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    return json(
      {
        error:
          message === 'Richiesta troppo grande'
            ? message
            : 'Operazione non completata. Ricarica la sessione; i risultati già salvati restano disponibili.',
      },
      message === 'Richiesta troppo grande' ? 413 : 503,
    );
  }
}
