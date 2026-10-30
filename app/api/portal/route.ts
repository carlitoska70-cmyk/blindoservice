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
import { authorizeVisit } from '@/lib/grants';
import { send, type NotifyEnv } from '@/lib/notify';
import { alertInspection } from '@/lib/holding-alert';
import { notifyPhones } from '@/lib/push';
import { matches } from '@/lib/search-terms';
import { controlPage } from '@/lib/holding';
export const dynamic = 'force-dynamic';

/**
 * Tells the owner an inspection started (Telegram/email). Failures never block the visit.
 * Telegram and email are outside the archive: the message carries no officer's personal data
 * (names and qualifications stay in Blindo Service), only the office and the declared subject.
 */
async function notifyOwner(req: Request, owner: string, d: any, auto: number) {
  try {
    const p = await db().prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<any>();
    const company = p ? JSON.parse(p.data).name : 'la tua attività';
    const text = [
      `CONTROLLO IN CORSO · ${company}`,
      `Ente: ${d.office}`,
      d.purpose ? `Oggetto dichiarato: ${d.purpose}` : '',
      auto
        ? `Esibizione automatica attiva: ${auto} documenti consultabili.`
        : 'In attesa della tua autorizzazione dei documenti.',
      `Apri Blindo Service e premi “Monitora controllo in corso”: ${new URL(req.url).origin}/`,
    ]
      .filter(Boolean)
      .join('\n');
    // The owner's phones first: the inspector is at the door.
    if (env.DB)
      await notifyPhones(env.DB, owner, {
        title: `🚨 Controllo in corso: ${String(d.office).slice(0, 60)}`,
        body: `${d.purpose ? `Motivo dichiarato: ${String(d.purpose).slice(0, 140)}. ` : ''}${auto ? `${auto} documenti già consultabili.` : 'Il controllore aspetta la tua autorizzazione.'} Apri Blindo e premi «Monitora controllo in corso».`,
        url: '/',
        tag: 'blindo-controllo',
      });
    await send(env as unknown as NotifyEnv, `Controllo in corso: ${d.office}`, text);
  } catch (e) {
    console.error('inspection notification failed', e instanceof Error ? e.message : 'unknown');
  }
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('portal');
    if (!id || id.length > 100) return response({ error: 'Accesso non disponibile' }, 404);
    const p = await db()
      .prepare(
        'SELECT p.id,p.owner,p.enabled,r.data FROM portals p LEFT JOIN profiles r ON p.owner=r.owner WHERE p.id=?',
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
    let found: any[] = [],
      haccp: ReturnType<typeof controlPage> = null;
    if (v?.status === 'autorizzata') {
      // The management software's HACCP page (Kassaro OS), offered only to an authorised inspector.
      const e = await db()
        .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='evidence'")
        .bind('evidenze:' + p.owner, p.owner)
        .first<{ data: string }>();
      haccp = e ? controlPage(JSON.parse(e.data), new Date()) : null;
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
      haccp,
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
          role: z.string().trim().max(160).default(''),
          purpose: z.string().trim().max(400).default(''),
          noticeRead: z.literal(true),
        })
        .parse(b.data);
      const changed = await db()
        .prepare('UPDATE visits SET data=?,status=?,last_seen=? WHERE id=? AND status=?')
        .bind(JSON.stringify(data), 'in_attesa', now, v.id, 'identificazione')
        .run();
      if (!changed.meta.changes) return response({ error: 'Identificazione già inviata' }, 409);
      await event(v, 'identificazione', {
        firstName: data.firstName,
        lastName: data.lastName,
        office: data.office,
      });
      // Automatic exhibition: documents the owner pre-approved become searchable at once,
      // so the inspection can proceed even when the owner is not on site.
      const settings = await db()
        .prepare('SELECT auto_share FROM portal_settings WHERE owner=?')
        .bind(v.owner)
        .first<{ auto_share: number }>();
      let auto = 0;
      if (settings?.auto_share) {
        const rows = await db()
          .prepare(
            "SELECT id FROM records WHERE owner=? AND kind='document' AND json_extract(data,'$.autoShare')=1 AND json_extract(data,'$.archivedAt') IS NULL",
          )
          .bind(v.owner)
          .all<{ id: string }>();
        const fresh = { ...v, data: JSON.stringify(data), status: 'in_attesa' };
        const result = await authorizeVisit(
          fresh,
          v.owner,
          rows.results.map(r => r.id),
          { auto: true, skipInvalid: true },
        );
        if (result.ok) auto = rows.results.length;
      }
      await notifyOwner(req, v.owner, data, auto);
      // Gionti Holding rings the owner's phone (only in the owner's own copy, which has the key).
      await alertInspection(env, {
        visitId: v.id,
        office: data.office,
        purpose: data.purpose || '',
        origin: new URL(req.url).origin,
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
          'SELECT g.document_id AS id,g.title,g.description,g.version,r.data AS meta FROM grants g LEFT JOIN records r ON r.id=g.document_id AND r.owner=g.owner WHERE g.visit_id=? ORDER BY g.title',
        )
        .bind(v.id)
        .all<any>();
      const matchesQuery = (x: any) => {
        const m = x.meta ? JSON.parse(x.meta) : {};
        return matches(
          query,
          [x.title, x.description, m.category, m.documentType, m.issuer, m.protocol]
            .filter(Boolean)
            .join(' '),
        );
      };
      const found = all.results
        .filter(matchesQuery)
        .slice(0, 60)
        .map(({ meta: _meta, ...x }: any) => x);
      await event(v, 'ricerca', { query, documentIds: found.map((x: any) => x.id) });
      await db().prepare('UPDATE visits SET last_seen=? WHERE id=?').bind(now, v.id).run();
      return response({ documents: found });
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
        { error: 'Compila nome, cognome, ufficio e targa; conferma la lettura dell’informativa.' },
        400,
      );
    return failure(e);
  }
}
