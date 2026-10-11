export const importSchema = `CREATE TABLE IF NOT EXISTS document_imports (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, file_id TEXT NOT NULL UNIQUE,
 source TEXT NOT NULL, data TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
 lease INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL
)`;
export const importIndex =
  'CREATE INDEX IF NOT EXISTS document_imports_owner ON document_imports(owner,status,created,id)';
export function blankDocument(fileId: string, fileName: string) {
  return {
    title: '',
    category: 'Altro',
    expires: '',
    issued: '',
    vat: '',
    address: '',
    notes: '',
    fileId,
    fileName,
    reviewed: false,
    reviewer: '',
    protocol: '',
    priority: 'Prioritario',
    publicDescription: '',
    issuer: '',
    holder: '',
    documentType: '',
  };
}
export function recognizedDocument(data: any, recognition: any) {
  const next = { ...data, recognition, reviewed: false, reviewer: '' };
  for (const key of [
    'title',
    'category',
    'documentType',
    'issuer',
    'holder',
    'vat',
    'address',
    'protocol',
    'issued',
    'expires',
    'publicDescription',
  ])
    next[key] = recognition.fields[key].value || (key === 'category' ? 'Altro' : '');
  return next;
}
type Deps = {
  authorize: () => Promise<{ userId: string } | null>;
  db: any;
  bucket: any;
  validate: (data: any, complete: boolean) => any;
  recognize: (req: Request) => Promise<Response>;
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const publicRow = (r: any) => ({
  ...r,
  data: JSON.parse(r.data),
  owner: undefined,
  lease: undefined,
  processing: r.lease > Date.now(),
});
async function smallBody(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 45000) throw new Error('BODY');
  if (!req.body) throw new Error('BODY');
  const reader = req.body.getReader();
  let count = 0,
    text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 45000) {
        await reader.cancel();
        throw new Error('BODY');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export async function handleImport(req: Request, deps: Deps) {
  try {
    const user = await deps.authorize();
    if (!user) return json({ error: 'Accesso richiesto' }, 401);
    if (req.method !== 'GET' && req.headers.get('origin') !== new URL(req.url).origin)
      return json({ error: 'Origine non valida' }, 403);
    const db = deps.db,
      bucket = deps.bucket,
      uid = user.userId;
    if (!db || !bucket) return json({ error: 'Archivio non disponibile' }, 503);
    await db.batch([db.prepare(importSchema), db.prepare(importIndex)]);
    const get = async (id: string) =>
      db.prepare('SELECT * FROM document_imports WHERE id=? AND owner=?').bind(id, uid).first();
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const row = await get(id);
        return row ? json({ item: publicRow(row) }) : json({ error: 'Bozza non trovata' }, 404);
      }
      const offset = Math.min(1000000, Math.max(0, Number(url.searchParams.get('offset')) || 0));
      const rows = await db
        .prepare(
          "SELECT id,source,error,version,created,lease,json_extract(data,'$.title') AS title,json_extract(data,'$.recognition') IS NOT NULL AS analyzed FROM document_imports WHERE owner=? AND status='pending' ORDER BY created,id LIMIT 100 OFFSET ?",
        )
        .bind(uid, offset)
        .all();
      const count = await db
        .prepare("SELECT count(*) AS n FROM document_imports WHERE owner=? AND status='pending'")
        .bind(uid)
        .first();
      return json({
        items: rows.results.map((r: any) => ({ ...r, processing: r.lease > Date.now(), lease: undefined })),
        total: count.n,
      });
    }
    if (req.method !== 'POST') return json({ error: 'Metodo non supportato' }, 405);
    if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
      if (Number(req.headers.get('content-length') || 0) > 20 * 1024 * 1024 + 65536)
        return json({ error: 'Massimo 20 MB per documento.' }, 413);
      const form = await req.formData(),
        id = String(form.get('id') || '');
      if (!/^[a-f0-9-]{36}$/.test(id)) return json({ error: 'Identificativo non valido' }, 400);
      const existing = await get(id);
      if (existing) return json({ item: publicRow(existing), duplicate: true });
      const file = form.get('file');
      if (
        !(file instanceof File) ||
        file.type !== 'application/pdf' ||
        file.size < 1 ||
        file.size > 20 * 1024 * 1024
      )
        return json({ error: 'Carica un PDF fino a 20 MB; converti prima le foto.' }, 400);
      const bytes = await file.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
        return json({ error: 'Il file non è un PDF valido.' }, 400);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
      const duplicate = await db
        .prepare('SELECT id FROM files WHERE owner=? AND sha256=? LIMIT 1')
        .bind(uid, hash)
        .first();
      if (duplicate) {
        const pending = await db
          .prepare("SELECT * FROM document_imports WHERE file_id=? AND owner=? AND status='pending'")
          .bind(duplicate.id, uid)
          .first();
        if (pending) return json({ item: publicRow(pending), duplicate: true });
        const saved = await db
          .prepare(
            "SELECT id FROM records WHERE owner=? AND kind='document' AND json_extract(data,'$.fileId')=? LIMIT 1",
          )
          .bind(uid, duplicate.id)
          .first();
        if (saved) return json({ duplicate: true, archived: true });
      }
      const key = uid + '/' + crypto.randomUUID(),
        now = new Date().toISOString();
      const data = blankDocument(id, file.name.slice(0, 255));
      await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
      try {
        await db.batch([
          db
            .prepare('INSERT INTO files(id,owner,name,mime,object_key,sha256,created) VALUES(?,?,?,?,?,?,?)')
            .bind(id, uid, data.fileName, 'application/pdf', key, hash, now),
          db
            .prepare('INSERT INTO document_imports(id,owner,file_id,source,data,created) VALUES(?,?,?,?,?,?)')
            .bind(
              id,
              uid,
              id,
              String(form.get('source') || file.name).slice(0, 1000),
              JSON.stringify(data),
              now,
            ),
        ]);
      } catch (e) {
        await bucket.delete(key);
        const retry = await get(id);
        if (retry) return json({ item: publicRow(retry), duplicate: true });
        throw e;
      }
      return json({ item: publicRow(await get(id)) });
    }
    const b = await smallBody(req);
    if (!b || typeof b.id !== 'string' || b.id.length > 100) return json({ error: 'Bozza non valida' }, 400);
    const row = await get(b.id);
    if (!row) return json({ error: 'Bozza non trovata' }, 404);
    if (row.status === 'saved')
      return b.action === 'save'
        ? json({ saved: true, id: row.id })
        : json({ error: 'Documento già archiviato' }, 409);
    if (row.status === 'deleted') {
      if (b.action !== 'discard') return json({ error: 'Bozza eliminata' }, 409);
      const file = await db
        .prepare('SELECT object_key FROM files WHERE id=? AND owner=?')
        .bind(row.file_id, uid)
        .first();
      if (file) {
        await bucket.delete(file.object_key);
        await db.prepare('DELETE FROM files WHERE id=? AND owner=?').bind(row.file_id, uid).run();
      }
      await db
        .prepare(
          "UPDATE document_imports SET data='{}',source='',error='' WHERE id=? AND owner=? AND status='deleted'",
        )
        .bind(row.id, uid)
        .run();
      return json({ deleted: true });
    }
    if (row.lease > Date.now()) return json({ error: 'Analisi in corso. Attendi il completamento.' }, 409);
    if (b.version !== row.version)
      return json({ error: 'La bozza è cambiata in un’altra finestra. Riaprila prima di continuare.' }, 409);
    if (b.action === 'analyze') {
      const lease = Date.now() + 100000;
      const claim = await db
        .prepare(
          "UPDATE document_imports SET lease=? WHERE id=? AND owner=? AND version=? AND status='pending' AND lease<=?",
        )
        .bind(lease, row.id, uid, row.version, Date.now())
        .run();
      if (!claim.meta.changes) return json({ error: 'Analisi già avviata' }, 409);
      let result: any,
        error = '',
        ok = false,
        analysisStatus = 503;
      try {
        const response = await deps.recognize(
          new Request(req.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: url.origin },
            body: JSON.stringify({ fileId: row.file_id }),
          }),
        );
        analysisStatus = response.status;
        result = await response.json();
        ok = response.ok;
        if (!ok) error = result.error || 'Analisi non riuscita';
      } catch {
        error = 'Analisi interrotta: puoi riprovare.';
      }
      const data = ok ? recognizedDocument(JSON.parse(row.data), result.recognition) : JSON.parse(row.data);
      await db
        .prepare(
          'UPDATE document_imports SET data=?,error=?,lease=0,version=version+1 WHERE id=? AND owner=? AND lease=?',
        )
        .bind(JSON.stringify(data), error, row.id, uid, lease)
        .run();
      return json({
        item: publicRow(await get(row.id)),
        analysisFailed: !ok,
        pause: !ok && [401, 429, 502, 503, 504].includes(analysisStatus),
      });
    }
    if (b.action === 'discard') {
      // Imported files must never be removed if an archived revision or visitor grant references them.
      const ref = await db
        .prepare(
          "SELECT id FROM records WHERE owner=? AND (json_extract(data,'$.fileId')=? OR json_extract(data,'$.data.fileId')=?) LIMIT 1",
        )
        .bind(uid, row.file_id, row.file_id)
        .first();
      const grant = await db
        .prepare('SELECT id FROM grants WHERE owner=? AND file_id=? LIMIT 1')
        .bind(uid, row.file_id)
        .first();
      if (ref || grant)
        return json(
          { error: 'Allegato già utilizzato nell’archivio: non può essere eliminato dalla coda.' },
          409,
        );
      const changed = await db
        .prepare(
          "UPDATE document_imports SET status='deleted',version=version+1 WHERE id=? AND owner=? AND version=? AND status='pending' AND lease<=?",
        )
        .bind(row.id, uid, row.version, Date.now())
        .run();
      if (!changed.meta.changes) return json({ error: 'Bozza cambiata. Riaprila.' }, 409);
      const file = await db
        .prepare('SELECT object_key FROM files WHERE id=? AND owner=?')
        .bind(row.file_id, uid)
        .first();
      if (file) {
        await bucket.delete(file.object_key);
        await db.prepare('DELETE FROM files WHERE id=? AND owner=?').bind(row.file_id, uid).run();
      }
      await db
        .prepare(
          "UPDATE document_imports SET data='{}',source='',error='' WHERE id=? AND owner=? AND status='deleted'",
        )
        .bind(row.id, uid)
        .run();
      return json({ deleted: true });
    }
    if (b.action !== 'draft' && b.action !== 'save') return json({ error: 'Operazione non valida' }, 400);
    let data: any;
    try {
      data = deps.validate(
        { ...b.data, fileId: row.file_id, fileName: JSON.parse(row.data).fileName },
        b.action === 'save',
      );
    } catch {
      return json(
        {
          error:
            'Controlla titolo, date e campi della scheda. Se indichi una verifica, specifica chi l’ha effettuata.',
        },
        400,
      );
    }
    const now = new Date().toISOString();
    if (b.action === 'draft') {
      const changed = await db
        .prepare(
          "UPDATE document_imports SET data=?,version=version+1 WHERE id=? AND owner=? AND version=? AND status='pending' AND lease<=?",
        )
        .bind(JSON.stringify(data), row.id, uid, row.version, Date.now())
        .run();
      return changed.meta.changes
        ? json({ item: publicRow(await get(row.id)) })
        : json({ error: 'Bozza cambiata. Riaprila.' }, 409);
    }
    // One transaction: record creation and queue transition. Deterministic record id prevents duplicate saves.
    const saved = await db.batch([
      db
        .prepare(
          "INSERT INTO records(id,owner,kind,data,created,updated) SELECT id,owner,'document',?,?,? FROM document_imports WHERE id=? AND owner=? AND version=? AND status='pending' AND lease<=?",
        )
        .bind(JSON.stringify(data), now, now, row.id, uid, row.version, Date.now()),
      db
        .prepare(
          "UPDATE document_imports SET status='saved',data=?,version=version+1 WHERE id=? AND owner=? AND version=? AND status='pending' AND EXISTS(SELECT 1 FROM records WHERE records.id=document_imports.id AND records.owner=document_imports.owner)",
        )
        .bind(JSON.stringify(data), row.id, uid, row.version),
    ]);
    return saved[0].meta.changes
      ? json({ saved: true, id: row.id })
      : json({ error: 'La bozza è cambiata. Riaprila.' }, 409);
  } catch (e) {
    if (e instanceof Error && e.message === 'BODY')
      return json({ error: 'Scheda troppo grande o richiesta vuota' }, 413);
    if (e instanceof SyntaxError) return json({ error: 'Richiesta non valida' }, 400);
    return json({ error: 'Operazione non riuscita. La coda già caricata resta conservata: riprova.' }, 503);
  }
}
