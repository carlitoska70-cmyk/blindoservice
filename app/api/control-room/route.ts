import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { body, db, event, failure, origin, owner, response, token } from '@/lib/portal-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const uid = await owner();
    const [p, v, logs] = await Promise.all([
      db().prepare('SELECT * FROM portals WHERE owner=?').bind(uid).first(),
      db().prepare('SELECT * FROM visits WHERE owner=? ORDER BY created DESC LIMIT 100').bind(uid).all(),
      db()
        .prepare('SELECT * FROM portal_events WHERE owner=? ORDER BY created DESC LIMIT 400')
        .bind(uid)
        .all(),
    ]);
    const grants = await db().prepare('SELECT * FROM grants WHERE owner=?').bind(uid).all();
    return response({
      portal: p,
      visits: v.results.map((x: any) => ({ ...x, token_hash: undefined, data: JSON.parse(x.data) })),
      events: logs.results.map((x: any) => ({ ...x, data: JSON.parse(x.data) })),
      grants: grants.results,
      aiReady: !!env.OPENAI_API_KEY,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    origin(req);
    const uid = await owner();
    const b = await body(req),
      now = new Date().toISOString();
    if (b.action === 'portal') {
      const enabled = z.boolean().parse(b.enabled);
      if (enabled) {
        const p = await db().prepare('SELECT data FROM profiles WHERE owner=?').bind(uid).first<any>();
        if (!p || String(JSON.parse(p.data).portalNotice || '').trim().length < 120)
          return response(
            {
              error:
                'Completa l’informativa del portale nella sezione Azienda prima di attivare gli accessi.',
            },
            400,
          );
      }
      await db()
        .prepare(
          'INSERT INTO portals(id,owner,enabled,created) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled',
        )
        .bind(token(), uid, enabled ? 1 : 0, now)
        .run();
      return response({ ok: true });
    }
    const visitId = z.string().max(100).parse(b.visitId);
    const v = await db()
      .prepare('SELECT * FROM visits WHERE id=? AND owner=?')
      .bind(visitId, uid)
      .first<any>();
    if (!v) return response({ error: 'Sessione non trovata' }, 404);
    if (b.action === 'revoke') {
      await db()
        .prepare('UPDATE visits SET status=?,active_doc=NULL WHERE id=? AND owner=?')
        .bind('chiusa', v.id, uid)
        .run();
      await event(v, 'revoca', {});
      return response({ ok: true });
    }
    if (b.action === 'grants') {
      if (v.status === 'chiusa' || v.expires <= now)
        return response({ error: 'Sessione terminata o scaduta' }, 409);
      if (!['in_attesa', 'autorizzata'].includes(v.status))
        return response({ error: 'Attendi l’inserimento dei dati identificativi' }, 409);
      if (b.identityVerified !== true)
        return response(
          { error: 'Conferma di aver verificato l’identità e la pertinenza dei documenti' },
          400,
        );
      const ids = z.array(z.string().max(100)).max(150).parse(b.documentIds);
      const rows = await db()
        .prepare("SELECT id,data,updated FROM records WHERE owner=? AND kind='document'")
        .bind(uid)
        .all<any>();
      const docs = rows.results.filter((x: any) => ids.includes(x.id));
      if (docs.length !== new Set(ids).size) return response({ error: 'Documento non trovato' }, 400);
      const stmts: any[] = [db().prepare('DELETE FROM grants WHERE visit_id=? AND owner=?').bind(v.id, uid)];
      const details: any[] = [];
      for (const doc of docs) {
        const d = JSON.parse(doc.data);
        if (!d.fileId) return response({ error: 'Allega un originale a ' + d.title }, 400);
        const f = await db()
          .prepare('SELECT mime FROM files WHERE id=? AND owner=?')
          .bind(d.fileId, uid)
          .first<any>();
        if (!f || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.mime))
          return response({ error: 'Allegato non esibibile' }, 400);
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
        const identity = JSON.parse(v.data);
        const data = {
          authority: identity.office,
          scope: identity.purpose,
          officers: identity.firstName + ' ' + identity.lastName + ' · ' + identity.role,
          reference: 'Sessione QR ' + v.id.slice(0, 8),
          status: 'aperto',
          outcome: '',
          started: v.created,
          ended: '',
        };
        stmts.push(
          db()
            .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
            .bind(inspectionId, uid, 'inspection', JSON.stringify(data), now, now),
        );
      }
      stmts.push(
        db()
          .prepare('UPDATE visits SET status=?,inspection_id=?,active_doc=NULL WHERE id=? AND owner=?')
          .bind('autorizzata', inspectionId, v.id, uid),
      );
      await db().batch(stmts);
      await event(v, 'autorizzazione', { documents: details, identityVerified: true });
      return response({ ok: true, inspectionId });
    }
    if (b.action === 'report') {
      const log = await db()
        .prepare('SELECT kind,data,created FROM portal_events WHERE visit_id=? AND owner=? ORDER BY created')
        .bind(v.id, uid)
        .all<any>();
      const notes = v.inspection_id
        ? await db()
            .prepare(
              "SELECT id,kind,data,created FROM records WHERE owner=? AND kind IN ('event','transcript','review') AND json_extract(data,'$.inspectionId')=? ORDER BY created",
            )
            .bind(uid, v.inspection_id)
            .all<any>()
        : { results: [] };
      const identity = JSON.parse(v.data);
      const text = [
        'PRESIDIO — RESOCONTO DOCUMENTALE',
        `Generato: ${now}`,
        `Sessione: ${v.id}`,
        `Dati dichiarati: ${identity.firstName || ''} ${identity.lastName || ''} — ${identity.office || ''} — ${identity.role || ''}`,
        `Oggetto: ${identity.purpose || ''}`,
        `Stato: ${v.status}`,
        `Inizio: ${v.created}`,
        'CRONOLOGIA DEL PORTALE',
        ...log.results.map((e: any) => e.created + ' | ' + e.kind + ' | ' + e.data),
        'ANNOTAZIONI, AUDIO, TRASCRIZIONI E BOZZE IA',
        ...notes.results.map((n: any) => n.created + ' | ' + n.kind + ' | ' + n.data),
        'REVISIONE DA COMPLETARE',
        'Confrontare con verbale, originali e trascrizione verificata. Distinguere fatti, dichiarazioni e ipotesi. Nessun illecito è accertato automaticamente.',
        'Questa cronologia attesta eventi applicativi; non prova che una persona abbia letto, compreso o approvato il contenuto. Il documento erogato è identificato dalla versione e dall’impronta SHA-256 quando disponibile. Nessuna certificazione di data certa o conservazione a norma.',
      ].join('\n\n');
      return response({ text });
    }
    return response({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    return failure(e);
  }
}
