import { env } from 'cloudflare:workers';
import { getMember } from '@/lib/operator';
import { z } from 'zod';
import { defaultProfile } from '@/lib/product';
import { archivableKinds, profileSchema, recordSchemas } from '@/lib/schemas';
import { RETENTION_FIELDS, dropFiles, retentionId, writeState } from '@/lib/retention';
import { staffDocUntil, staffRecordUntil } from '@/lib/staff';
import { romeToday } from '@/lib/reminders';
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
    // Records are hard-deleted only by retention, which forces a full reload (below).
    let since = params.get('since') || '';
    if (since && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since))
      return json({ error: 'Cursore non valido' }, 400);
    // Retention deletes records for real: after a deletion the client reloads everything.
    const purged = await db
      .prepare("SELECT json_extract(data,'$.lastPurge') AS at FROM records WHERE id=? AND owner=?")
      .bind(retentionId(owner), owner)
      .first<{ at: string | null }>();
    if (since && purged?.at && purged.at > since) since = '';
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
    const cursor = records.reduce(
      (max: string, x: any) => (x.updated > max ? x.updated : max),
      [since, purged?.at || ''].sort().pop()!,
    );
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
    if (b.action === 'procedimento') {
      // «Procedimento in corso» keeps the inspection file out of the 120-day deletion until closed.
      const id = str(100).parse(b.id);
      const version = str(40).parse(b.version);
      const open = z.boolean().parse(b.open);
      const hold = open
        ? z
            .object({
              dal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
              riferimento: str(200),
              nota: str(1000),
            })
            .parse(b.hold)
        : null;
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO records(id,owner,kind,data,created,updated) SELECT ?,owner,'revision',json_object('recordId',id,'kind',kind,'data',json(data),'updated',updated),?,? FROM records WHERE id=? AND owner=? AND kind='inspection' AND updated=?",
          )
          .bind(crypto.randomUUID(), now, now, id, owner, version),
        open
          ? db
              .prepare(
                "UPDATE records SET data=json_remove(json_set(data,'$.procedimento',json(?)),'$.procedimentoChiuso'),updated=? WHERE id=? AND owner=? AND kind='inspection' AND updated=? AND json_extract(data,'$.anonimizzato') IS NULL",
              )
              .bind(JSON.stringify(hold), now, id, owner, version)
          : db
              .prepare(
                "UPDATE records SET data=json_set(data,'$.procedimentoChiuso',?),updated=? WHERE id=? AND owner=? AND kind='inspection' AND updated=? AND json_extract(data,'$.procedimento') IS NOT NULL AND json_extract(data,'$.procedimentoChiuso') IS NULL",
              )
              .bind(now, now, id, owner, version),
      ]);
      if (!results[1].meta.changes)
        return json({ error: 'Il fascicolo è cambiato. Ricarica i dati prima di riprovare.' }, 409);
      return json({ ok: true, id });
    }
    if (b.action === 'purge') {
      // Deletion confirmed by the owner, only for former employees past their retention term.
      if (staff) return staffDenied();
      const kind = z.enum(['document', 'employee']).parse(b.kind);
      const id = str(100).parse(b.id);
      const version = str(40).parse(b.version);
      const row = await db
        .prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=? AND updated=?')
        .bind(id, owner, kind, version)
        .first<{ data: string }>();
      if (!row) return json({ error: 'Il record è cambiato. Ricarica i dati prima di riprovare.' }, 409);
      const data = JSON.parse(row.data);
      const today = romeToday();
      let until: string | null = null;
      if (kind === 'document') {
        const emp = data.employeeId
          ? await db
              .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='employee'")
              .bind(data.employeeId, owner)
              .first<{ data: string }>()
          : null;
        until = emp ? staffDocUntil(JSON.parse(emp.data), data)?.until || null : null;
      } else {
        until = staffRecordUntil(data);
        const linked = await db
          .prepare(
            "SELECT count(*) AS n FROM records WHERE owner=? AND kind='document' AND json_extract(data,'$.employeeId')=?",
          )
          .bind(owner, id)
          .first<{ n: number }>();
        if (linked?.n) return json({ error: 'Prima cancella i documenti abbinati a questa persona.' }, 409);
      }
      if (!until || until > today)
        return json(
          {
            error:
              'Si può cancellare solo il fascicolo di un ex dipendente, dopo il termine di conservazione.',
          },
          409,
        );
      await db.batch([
        db
          .prepare(
            "DELETE FROM records WHERE owner=? AND kind='revision' AND json_extract(data,'$.recordId')=?",
          )
          .bind(owner, id),
        db.prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(id, owner, kind),
      ]);
      const files =
        kind === 'document' && data.fileId ? await dropFiles(env, owner, [data.fileId], new Set([id])) : 0;
      await writeState(
        db,
        owner,
        now,
        { controlli: 0, sessioni: 0, file: files, documenti: 1 },
        { run: false },
      );
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
      // Retention fields of an inspection belong to the server: the edit form never changes them.
      let stored: any = data;
      if (kind === 'inspection') {
        const cur = await db
          .prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=? AND updated=?')
          .bind(id, owner, kind, version)
          .first<{ data: string }>();
        const old = cur ? JSON.parse(cur.data) : {};
        stored = { ...data };
        for (const f of RETENTION_FIELDS) if (old[f] !== undefined) stored[f] = old[f];
      }
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
          .bind(JSON.stringify(stored), now, id, owner, kind, version),
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
