import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  body,
  db,
  digest,
  event,
  failure,
  origin,
  rate,
  response,
  safeVisit,
  token,
  visitor,
} from '@/lib/portal-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('portal');
    if (!id || id.length > 100) return response({ error: 'Accesso non disponibile' }, 404);
    const p = await db()
      .prepare(
        'SELECT p.id,p.enabled,r.data FROM portals p LEFT JOIN profiles r ON p.owner=r.owner WHERE p.id=?',
      )
      .bind(id)
      .first<any>();
    if (!p || !p.enabled)
      return response(
        { error: 'Portale non attivo. Rivolgiti al responsabile per l’esibizione dei documenti.' },
        404,
      );
    let v = await visitor(req);
    if (v?.portal_id !== id) v = null;
    let found: any[] = [];
    if (v?.status === 'autorizzata') {
      const rows = await db()
        .prepare(
          "SELECT g.document_id AS id,g.title,g.description,g.version FROM grants g WHERE g.visit_id=? AND EXISTS (SELECT 1 FROM portal_events e WHERE e.visit_id=g.visit_id AND e.kind='ricerca' AND e.data LIKE '%'||g.document_id||'%')",
        )
        .bind(v.id)
        .all();
      found = rows.results;
    }
    return response({
      company: p.data ? JSON.parse(p.data).name : 'Archivio aziendale',
      notice: p.data ? JSON.parse(p.data).portalNotice || '' : '',
      visit: safeVisit(v),
      history: found,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    origin(req);
    const b = await body(req);
    let v = await visitor(req);
    const now = new Date().toISOString();
    if (b.action === 'start') {
      const portal = z.string().min(32).max(100).parse(b.portal);
      const p = await db()
        .prepare('SELECT * FROM portals WHERE id=? AND enabled=1')
        .bind(portal)
        .first<any>();
      if (!p) return response({ error: 'Accesso non disponibile. Contatta il responsabile.' }, 404);
      if (v?.portal_id === portal) return response({ visit: safeVisit(v) });
      await rate(portal + ':' + (req.headers.get('cf-connecting-ip') || 'anonymous'), 15, 3600);
      const secret = token(),
        id = crypto.randomUUID(),
        expires = new Date(Date.now() + 4 * 3600000).toISOString();
      await db()
        .prepare(
          'INSERT INTO visits(id,owner,portal_id,token_hash,status,data,created,expires,last_seen) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(id, p.owner, portal, await digest(secret), 'identificazione', '{}', now, expires, now)
        .run();
      v = { id, owner: p.owner };
      await event(v, 'accesso', {});
      return response({ visit: { id, status: 'identificazione', data: {}, created: now, expires } }, 200, {
        'Set-Cookie': `presidio_visit=${secret}; HttpOnly; Secure; SameSite=Strict; Path=/api/portal; Max-Age=14400`,
      });
    }
    if (!v) return response({ error: 'Sessione scaduta o revocata. Scansiona nuovamente il QR.' }, 401);
    await rate(v.id);
    if (b.action === 'identify') {
      if (v.status !== 'identificazione') return response({ error: 'Identificazione già inviata' }, 409);
      const data = z
        .object({
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100),
          office: z.string().trim().min(1).max(160),
          role: z.string().trim().min(1).max(160),
          plate: z.string().trim().max(20),
          purpose: z.string().trim().min(1).max(400),
          noticeRead: z.literal(true),
        })
        .parse(b.data);
      await db()
        .prepare('UPDATE visits SET data=?,status=?,last_seen=? WHERE id=? AND status=?')
        .bind(JSON.stringify(data), 'in_attesa', now, v.id, 'identificazione')
        .run();
      await event(v, 'identificazione', {
        firstName: data.firstName,
        lastName: data.lastName,
        office: data.office,
      });
      return response({ ok: true });
    }
    if (b.action === 'help') {
      await event(v, 'assistenza', { message: 'Richiesta esibizione assistita al responsabile' });
      return response({ ok: true });
    }
    if (b.action === 'heartbeat') {
      await db().prepare('UPDATE visits SET last_seen=? WHERE id=?').bind(now, v.id).run();
      return response({ ok: true });
    }
    if (v.status !== 'autorizzata')
      return response({ error: 'Attendi l’autorizzazione del responsabile' }, 403);
    if (b.action === 'search') {
      const query = z.string().trim().min(2).max(150).parse(b.query);
      const all = await db()
        .prepare(
          'SELECT document_id AS id,title,description,version FROM grants WHERE visit_id=? ORDER BY title',
        )
        .bind(v.id)
        .all<any>();
      const matches = all.results
        .filter((x: any) =>
          (x.title + ' ' + x.description).toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')),
        )
        .slice(0, 60);
      await event(v, 'ricerca', { query, documentIds: matches.map((x: any) => x.id) });
      await db().prepare('UPDATE visits SET last_seen=? WHERE id=?').bind(now, v.id).run();
      return response({ documents: matches });
    }
    if (b.action === 'open') {
      const documentId = z.string().max(100).parse(b.documentId);
      const g = await db()
        .prepare('SELECT * FROM grants WHERE visit_id=? AND document_id=?')
        .bind(v.id, documentId)
        .first<any>();
      if (!g) return response({ error: 'Documento non autorizzato' }, 404);
      await db()
        .prepare('UPDATE visits SET active_doc=?,active_page=NULL,last_seen=? WHERE id=?')
        .bind(documentId, now, v.id)
        .run();
      await event(v, 'apertura', { documentId, title: g.title, version: g.version });
      return response({ url: '/api/portal/file?document=' + encodeURIComponent(documentId), title: g.title });
    }
    if (b.action === 'closeDocument') {
      await db()
        .prepare('UPDATE visits SET active_doc=NULL,active_page=NULL,last_seen=? WHERE id=?')
        .bind(now, v.id)
        .run();
      await event(v, 'chiusura_documento', {});
      return response({ ok: true });
    }
    if (b.action === 'finish') {
      await db().prepare('UPDATE visits SET status=?,active_doc=NULL WHERE id=?').bind('chiusa', v.id).run();
      await event(v, 'fine', {});
      return response({ ok: true });
    }
    return response({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    if (e instanceof z.ZodError)
      return response(
        { error: 'Compila nome, cognome, ufficio, ruolo e oggetto; conferma la lettura dell’informativa.' },
        400,
      );
    return failure(e);
  }
}
