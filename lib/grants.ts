// Grants a visit access to selected documents (version pinned at authorization)
// and opens the inspection file. Used by the owner and by automatic exhibition.
import { db, event } from './portal-server';

export const EXHIBITABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

type Result = { ok: true; inspectionId: string } | { ok: false; error: string; status: number };

export async function authorizeVisit(
  v: any,
  uid: string,
  ids: string[],
  opts: { auto?: boolean; skipInvalid?: boolean } = {},
): Promise<Result> {
  const now = new Date().toISOString();
  if (v.status === 'chiusa' || v.expires <= now)
    return { ok: false, error: 'Sessione terminata o scaduta', status: 409 };
  if (!['in_attesa', 'autorizzata'].includes(v.status))
    return { ok: false, error: 'Attendi l’inserimento dei dati identificativi', status: 409 };
  const rows = await db()
    .prepare("SELECT id,data,updated FROM records WHERE owner=? AND kind='document'")
    .bind(uid)
    .all<any>();
  const docs = rows.results.filter((x: any) => ids.includes(x.id));
  if (docs.length !== new Set(ids).size) return { ok: false, error: 'Documento non trovato', status: 400 };
  const stmts: any[] = [db().prepare('DELETE FROM grants WHERE visit_id=? AND owner=?').bind(v.id, uid)];
  const details: any[] = [];
  for (const doc of docs) {
    const d = JSON.parse(doc.data);
    const f = d.fileId
      ? await db().prepare('SELECT mime FROM files WHERE id=? AND owner=?').bind(d.fileId, uid).first<any>()
      : null;
    const problem = d.archivedAt
      ? 'Documento archiviato: ripristinalo prima di esibirlo'
      : !d.fileId
        ? 'Allega un originale a ' + d.title
        : !f || !EXHIBITABLE.includes(f.mime)
          ? 'Allegato non esibibile'
          : '';
    if (problem) {
      if (opts.skipInvalid) continue;
      return { ok: false, error: problem, status: 400 };
    }
    stmts.push(
      db()
        .prepare(
          'INSERT INTO grants(id,owner,visit_id,document_id,file_id,title,description,version,created) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          uid,
          v.id,
          doc.id,
          d.fileId,
          d.title,
          d.publicDescription || d.category,
          doc.updated,
          now,
        ),
    );
    details.push({ documentId: doc.id, fileId: d.fileId, version: doc.updated, title: d.title });
  }
  let inspectionId = v.inspection_id;
  if (!inspectionId) {
    inspectionId = crypto.randomUUID();
    stmts.push(inspectionInsert(v, uid, inspectionId, now));
  }
  stmts.push(
    db()
      .prepare('UPDATE visits SET status=?,inspection_id=?,active_doc=NULL WHERE id=? AND owner=?')
      .bind('autorizzata', inspectionId, v.id, uid),
  );
  await db().batch(stmts);
  await event(v, 'autorizzazione', { documents: details, identityVerified: !opts.auto, auto: !!opts.auto });
  return { ok: true, inspectionId };
}

/** Inspection file created from the identity the inspector declared in the portal. */
export function inspectionInsert(v: any, uid: string, inspectionId: string, now: string) {
  const identity = JSON.parse(v.data || '{}');
  const data = {
    authority: identity.office || 'Ente non dichiarato',
    scope: identity.purpose || 'Oggetto non dichiarato',
    officers: [
      [identity.firstName, identity.lastName].filter(Boolean).join(' '),
      identity.role,
      identity.plate ? 'targa ' + identity.plate : '',
    ]
      .filter(Boolean)
      .join(' · '),
    reference: 'Sessione QR ' + v.id.slice(0, 8),
    status: 'aperto',
    outcome: '',
    started: v.created,
    ended: '',
  };
  return db()
    .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
    .bind(inspectionId, uid, 'inspection', JSON.stringify(data), now, now);
}
