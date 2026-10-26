import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { body, db, event, failure, origin, owner, response, token } from '@/lib/portal-server';
import { authorizeVisit, inspectionInsert } from '@/lib/grants';
import { noticeProblem } from '@/lib/portal-notice';
import { CONTROL_DAYS } from '@/lib/retention';
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
    const settings = await db()
      .prepare('SELECT auto_share FROM portal_settings WHERE owner=?')
      .bind(uid)
      .first<{ auto_share: number }>();
    return response({
      portal: p,
      visits: v.results.map((x: any) => ({ ...x, token_hash: undefined, data: JSON.parse(x.data) })),
      events: logs.results.map((x: any) => ({ ...x, data: JSON.parse(x.data) })),
      grants: grants.results,
      aiReady: !!env.OPENAI_API_KEY,
      autoShare: !!settings?.auto_share,
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
        const problem = noticeProblem(p ? JSON.parse(p.data).portalNotice : '');
        if (problem) return response({ error: problem }, 400);
      }
      await db()
        .prepare(
          'INSERT INTO portals(id,owner,enabled,created) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled',
        )
        .bind(token(), uid, enabled ? 1 : 0, now)
        .run();
      return response({ ok: true });
    }
    if (b.action === 'settings') {
      const autoShare = z.boolean().parse(b.autoShare);
      await db()
        .prepare(
          'INSERT INTO portal_settings(owner,auto_share,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET auto_share=excluded.auto_share,updated=excluded.updated',
        )
        .bind(uid, autoShare ? 1 : 0, now)
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
    if (b.action === 'monitor') {
      // Opens (or reuses) the inspection file for live monitoring, even before documents are granted.
      if (v.status === 'chiusa') return response({ error: 'Sessione terminata' }, 409);
      if (v.inspection_id) return response({ ok: true, inspectionId: v.inspection_id });
      const inspectionId = crypto.randomUUID();
      await db().batch([
        inspectionInsert(v, uid, inspectionId, now),
        db()
          .prepare('UPDATE visits SET inspection_id=? WHERE id=? AND owner=? AND inspection_id IS NULL')
          .bind(inspectionId, v.id, uid),
      ]);
      await event(v, 'monitoraggio', { inspectionId });
      return response({ ok: true, inspectionId });
    }
    if (b.action === 'grants') {
      if (b.identityVerified !== true)
        return response(
          { error: 'Conferma di aver verificato l’identità e la pertinenza dei documenti' },
          400,
        );
      const ids = z.array(z.string().max(100)).max(150).parse(b.documentIds);
      const result = await authorizeVisit(v, uid, ids);
      if (!result.ok) return response({ error: result.error }, result.status);
      return response({ ok: true, inspectionId: result.inspectionId });
    }
    if (b.action === 'report' && b.scope === 'interessato') {
      // Access request (art. 15 GDPR) of the officer: what the portal recorded about the session,
      // without the owner's internal notes, recordings and AI drafts.
      const log = await db()
        .prepare('SELECT kind,data,created FROM portal_events WHERE visit_id=? AND owner=? ORDER BY created')
        .bind(v.id, uid)
        .all<any>();
      const identity = JSON.parse(v.data);
      const line = (e: any) => {
        const d = JSON.parse(e.data || '{}');
        const what =
          {
            identificazione: 'Dati identificativi inviati',
            ricerca: 'Ricerca: «' + (d.query || '') + '»',
            apertura: 'Documento aperto: ' + (d.title || ''),
            chiusura_documento: 'Documento chiuso',
            fine: 'Sessione terminata dal visitatore',
            revoca: 'Accesso chiuso dal titolare',
            autorizzazione: 'Documenti abilitati alla consultazione',
            monitoraggio: 'Fascicolo del controllo aperto dal titolare',
            accesso: 'Portale aperto dal QR',
            assistenza: 'Richiesta di assistenza al titolare',
            file_erogato: 'File del documento trasmesso',
            fine_controllo: 'Controllo concluso dal titolare',
          }[e.kind as string] || e.kind;
        return e.created + ' · ' + what;
      };
      const text = [
        'DATI PERSONALI REGISTRATI NEL PORTALE DEI CONTROLLI (art. 15 Reg. UE 2016/679)',
        `Generato: ${now}`,
        `Sessione: ${v.id.slice(0, 8)}`,
        'DATI DICHIARATI',
        `Nome e cognome: ${[identity.firstName, identity.lastName].filter(Boolean).join(' ') || '—'}`,
        `Ente e ufficio: ${identity.office || '—'}`,
        `Qualifica: ${identity.role || '—'}`,
        `Oggetto del controllo: ${identity.purpose || '—'}`,
        `Inizio della sessione: ${v.created} · ultimo segnale: ${v.last_seen}`,
        'ATTIVITÀ NEL PORTALE',
        ...log.results.map(line),
        'CONSERVAZIONE',
        `I dati della sessione vengono cancellati in automatico ${CONTROL_DAYS} giorni dopo la fine del controllo, salvo che sia in corso un procedimento: in quel caso alla sua conclusione.`,
        'Le eventuali registrazioni audio del colloquio non sono incluse in questo documento: la parte che la riguarda può essere chiesta al titolare.',
      ].join('\n\n');
      return response({ text });
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
        'BLINDO SERVICE — RESOCONTO DOCUMENTALE',
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
