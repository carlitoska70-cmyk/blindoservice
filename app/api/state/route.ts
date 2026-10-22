import { env } from 'cloudflare:workers';
import { getMember } from '@/lib/operator';
import { z } from 'zod';
import { defaultProfile } from '@/lib/product';
import { archivableKinds, profileSchema, recordSchemas } from '@/lib/schemas';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const str = (max = 4000) => z.string().max(max);
/** Kinds the collaborator may read and write: documents, actions, catalogue assessments. */
const STAFF_KINDS = ['document', 'task', 'requirement'];
async function ctx() {
  const u = await getMember();
  if (!u) throw new Error('AUTH');
  if (!env.DB) throw new Error('STORAGE');
  return { db: env.DB, owner: u.userId, staff: u.role !== 'owner' };
}
const staffDenied = () => json({ error: 'Operazione riservata al titolare' }, 403);
function failure(e: unknown) {
  if (e instanceof z.ZodError) return json({ error: e.issues[0]?.message || 'Dati non validi' }, 400);
  if (e instanceof Error && e.message === 'AUTH') return json({ error: 'Accesso richiesto' }, 401);
  console.error('presidio state failed', e instanceof Error ? e.message : 'unknown');
  return json(
    { error: 'Archivio temporaneamente non disponibile. I campi restano compilati: riprova.' },
    503,
  );
}
// Revisions grow with every edit and are only needed for the JSON export (?revisions=1).
export async function GET(req?: Request) {
  try {
    const { db, owner, staff } = await ctx();
    const params = req ? new URL(req.url).searchParams : new URLSearchParams();
    const withRevisions = params.get('revisions') === '1' && !staff;
    // Incremental sync: ?since=<last cursor> returns only records changed at or after it.
    // Records are never hard-deleted (archive is an update), so merging by id is complete.
    const since = params.get('since') || '';
    if (since && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since))
      return json({ error: 'Cursore non valido' }, 400);
    const [p, r] = await Promise.all([
      db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<{ data: string }>(),
      db
        .prepare(
          'SELECT id,kind,data,created,updated FROM records WHERE owner=?' +
            (withRevisions ? '' : " AND kind<>'revision'") +
            (since ? ' AND updated>=?' : '') +
            (staff ? ` AND kind IN (${STAFF_KINDS.map(k => `'${k}'`).join(',')})` : '') +
            ' ORDER BY created DESC',
        )
        .bind(...(since ? [owner, since] : [owner]))
        .all(),
    ]);
    const records = r.results.map((x: any) => ({ ...x, data: JSON.parse(x.data) }));
    const cursor = records.reduce((max: string, x: any) => (x.updated > max ? x.updated : max), since);
    return json({
      profile: p ? JSON.parse(p.data) : defaultProfile,
      records,
      cursor,
      partial: !!since,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    if (req.headers.get('origin') !== new URL(req.url).origin)
      return json({ error: 'Origine non valida' }, 403);
    const { db, owner, staff } = await ctx();
    if (Number(req.headers.get('content-length') || 0) > 50000)
      return json({ error: 'Richiesta troppo grande' }, 413);
    const raw = await req.text();
    if (raw.length > 50000) return json({ error: 'Richiesta troppo grande' }, 413);
    const b = JSON.parse(raw);
    const now = new Date().toISOString();
    if (staff && (b.action === 'profile' || !STAFF_KINDS.includes(b.kind))) return staffDenied();
    if (b.action === 'profile') {
      const data = profileSchema.parse(b.data);
      await db
        .prepare(
          'INSERT INTO profiles(owner,data,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data,updated=excluded.updated',
        )
        .bind(owner, JSON.stringify(data), now)
        .run();
      return json({ ok: true });
    }
    if (b.action === 'archive' || b.action === 'restore') {
      const kind = z.enum(archivableKinds).parse(b.kind);
      const id = str(100).parse(b.id);
      const version = str(40).parse(b.version);
      const archived = b.action === 'archive';
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated),?,? FROM records WHERE id=? AND owner=? AND kind=? AND updated=?",
          )
          .bind(crypto.randomUUID(), now, now, id, owner, kind, version),
        db
          .prepare(
            archived
              ? "UPDATE records SET data=json_set(data,'$.archivedAt',?),updated=? WHERE id=? AND owner=? AND kind=? AND updated=?"
              : "UPDATE records SET data=json_remove(data,'$.archivedAt'),updated=? WHERE id=? AND owner=? AND kind=? AND updated=?",
          )
          .bind(...(archived ? [now, now, id, owner, kind, version] : [now, id, owner, kind, version])),
      ]);
      if (!results[1].meta.changes)
        return json({ error: 'Il record è cambiato. Ricarica i dati prima di riprovare.' }, 409);
      return json({ ok: true, id });
    }
    const kind = z.enum(['document', 'inspection', 'event', 'task', 'requirement', 'employee']).parse(b.kind);
    const data = recordSchemas[kind].parse(b.data);
    if (kind === 'event') {
      const parent = await db
        .prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?')
        .bind((data as any).inspectionId, owner, 'inspection')
        .first<{ data: string }>();
      if (!parent) return json({ error: 'Controllo non trovato' }, 404);
      if (JSON.parse(parent.data).status !== 'aperto')
        return json(
          { error: 'Il fascicolo è concluso. Crea una nuova annotazione in un nuovo fascicolo.' },
          409,
        );
    }
    if ((data as any).fileId) {
      const f = await db
        .prepare('SELECT id FROM files WHERE id=? AND owner=?')
        .bind((data as any).fileId, owner)
        .first();
      if (!f) return json({ error: 'Allegato non trovato' }, 400);
    }
    if (b.action === 'update') {
      if (kind === 'event') return json({ error: 'Le annotazioni sono append-only' }, 400);
      const id = str(100).parse(b.id);
      const version = str(40).parse(b.version);
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated),?,? FROM records WHERE id=? AND owner=? AND kind=? AND updated=?",
          )
          .bind(crypto.randomUUID(), now, now, id, owner, kind, version),
        db
          .prepare(
            "UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND kind=? AND updated=? AND json_extract(data,'$.archivedAt') IS NULL",
          )
          .bind(JSON.stringify(data), now, id, owner, kind, version),
      ]);
      const r = results[1];
      if (!r.meta.changes)
        return json(
          { error: 'Il record è cambiato o è archiviato. Ricarica i dati prima di salvarlo.' },
          409,
        );
      return json({ ok: true, id });
    }
    if (b.action !== 'create') return json({ error: 'Operazione non valida' }, 400);
    const id = crypto.randomUUID();
    await db
      .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
      .bind(id, owner, kind, JSON.stringify(data), now, now)
      .run();
    return json({ ok: true, id });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: 'Richiesta non valida' }, 400);
    return failure(e);
  }
}
