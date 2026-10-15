import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db, event, failure, rate, response } from '@/lib/portal-server';
import { getOperator } from '@/lib/operator';
import { responsesJson, transcribe } from '@/lib/openai';
import {
  HINT_INSTRUCTIONS,
  HINT_MODEL,
  parseHint,
  REPORT_INSTRUCTIONS,
  REPORT_MODEL,
  reportBlocks,
  TRANSCRIBE_MODEL,
  validateReport,
  type LiveDoc,
} from '@/lib/live';
import { textPdf } from '@/lib/text-pdf';
import { defaultProfile } from '@/lib/product';
export const dynamic = 'force-dynamic';

const MAX_SEGMENT = 4 * 1024 * 1024;
const ai = () => ({ key: env.OPENAI_API_KEY!, base: env.OPENAI_BASE_URL });

async function save(uid: string, kind: string, data: unknown) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await db()
    .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
    .bind(id, uid, kind, JSON.stringify(data), now, now)
    .run();
  return id;
}

async function inspection(uid: string, id: string) {
  const row = await db()
    .prepare("SELECT id,data,updated FROM records WHERE id=? AND owner=? AND kind='inspection'")
    .bind(id, uid)
    .first<{ id: string; data: string; updated: string }>();
  return row ? { ...row, data: JSON.parse(row.data) } : null;
}

async function documents(uid: string): Promise<LiveDoc[]> {
  const rows = await db()
    .prepare(
      "SELECT id,data FROM records WHERE owner=? AND kind='document' AND json_extract(data,'$.archivedAt') IS NULL",
    )
    .bind(uid)
    .all<{ id: string; data: string }>();
  return rows.results.slice(0, 200).map(r => {
    const d = JSON.parse(r.data);
    return { id: r.id, title: d.title, category: d.category, expires: d.expires || '', hasFile: !!d.fileId };
  });
}

async function segments(uid: string, inspectionId: string) {
  const rows = await db()
    .prepare(
      "SELECT data,created FROM records WHERE owner=? AND kind='live_segment' AND json_extract(data,'$.inspectionId')=? ORDER BY json_extract(data,'$.seq')",
    )
    .bind(uid, inspectionId)
    .all<{ data: string; created: string }>();
  return rows.results.map(r => ({ ...JSON.parse(r.data), created: r.created }));
}

/** What the inspector is doing right now in the portal (latest visit of this inspection). */
async function agentActivity(uid: string, inspectionId: string) {
  const v = await db()
    .prepare('SELECT id,data,active_doc FROM visits WHERE owner=? AND inspection_id=? ORDER BY created DESC')
    .bind(uid, inspectionId)
    .first<any>();
  if (!v) return null;
  const doc = v.active_doc
    ? await db()
        .prepare('SELECT title FROM grants WHERE visit_id=? AND document_id=?')
        .bind(v.id, v.active_doc)
        .first<any>()
    : null;
  const search = await db()
    .prepare("SELECT data FROM portal_events WHERE visit_id=? AND kind='ricerca' ORDER BY created DESC")
    .bind(v.id)
    .first<any>();
  return {
    visitId: v.id,
    identity: JSON.parse(v.data || '{}'),
    viewing: doc?.title || null,
    lastSearch: search ? JSON.parse(search.data).query : null,
  };
}

async function onSegment(req: Request, uid: string) {
  const form = await req.formData();
  const inspectionId = z.string().max(100).parse(form.get('inspectionId'));
  const seq = z.coerce.number().int().min(0).max(100000).parse(form.get('seq'));
  const offsetMs = z.coerce.number().int().min(0).max(86400000).parse(form.get('offsetMs'));
  const file = form.get('file');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_SEGMENT ||
    !file.type.startsWith('audio/')
  )
    return response({ error: 'Segmento audio non valido' }, 400);
  const ins = await inspection(uid, inspectionId);
  if (!ins) return response({ error: 'Fascicolo non trovato' }, 404);
  if (ins.data.status !== 'aperto') return response({ error: 'Il controllo è già terminato' }, 409);
  await rate('live:' + uid, 900, 3600);
  const previous = await segments(uid, inspectionId);
  const context = previous.map(p => p.text).join(' ');
  const text = await transcribe(ai(), file, file.name || 'segmento.webm', {
    model: TRANSCRIBE_MODEL,
    prompt: context,
  });
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return response({ segment: null, hint: null });
  const segmentId = await save(uid, 'live_segment', {
    inspectionId,
    seq,
    offsetMs,
    text: text.slice(0, 4000),
    model: TRANSCRIBE_MODEL,
  });
  const docs = await documents(uid);
  const recent = [...previous.slice(-12).map(p => p.text), text].join('\n');
  let hint = null;
  try {
    const raw = await responsesJson(ai(), {
      model: HINT_MODEL,
      instructions: HINT_INSTRUCTIONS,
      input: JSON.stringify({
        trascrizioneRecente: recent.slice(-6000),
        segmentoPiuRecente: text,
        agente: await agentActivity(uid, inspectionId),
        documenti: docs,
      }),
      maxTokens: 500,
      timeoutMs: 20000,
    });
    hint = parseHint(raw, new Set(docs.map(d => d.id)));
  } catch (e) {
    console.error('live hint failed', e instanceof Error ? e.message : 'unknown');
  }
  let hintId = null;
  if (hint)
    hintId = await save(uid, 'live_hint', { inspectionId, seq, segmentId, ...hint, model: HINT_MODEL });
  return response({
    segment: { id: segmentId, seq, offsetMs, text },
    hint: hint ? { id: hintId, seq, ...hint } : null,
  });
}

async function onFinish(req: Request, uid: string) {
  const b = await req.json<any>();
  const inspectionId = z.string().max(100).parse(b.inspectionId);
  const audioEventId = z
    .string()
    .max(100)
    .optional()
    .parse(b.audioEventId || undefined);
  const ins = await inspection(uid, inspectionId);
  if (!ins) return response({ error: 'Fascicolo non trovato' }, 404);
  const now = new Date().toISOString();
  // 1. Close the portal session(s) of this inspection and the inspection file.
  const visits = await db()
    .prepare("SELECT * FROM visits WHERE owner=? AND inspection_id=? AND status<>'chiusa'")
    .bind(uid, inspectionId)
    .all<any>();
  for (const v of visits.results) {
    await db()
      .prepare("UPDATE visits SET status='chiusa',active_doc=NULL WHERE id=? AND owner=?")
      .bind(v.id, uid)
      .run();
    await event(v, 'fine_controllo', { by: 'titolare' });
  }
  if (ins.data.status === 'aperto')
    await db()
      .prepare(
        "UPDATE records SET data=json_set(data,'$.status','concluso','$.ended',?),updated=? WHERE id=? AND owner=? AND kind='inspection'",
      )
      .bind(now, now, inspectionId, uid)
      .run();
  if (!env.OPENAI_API_KEY)
    return response({
      closed: true,
      reportId: null,
      error: 'Servizio IA non collegato: controllo chiuso e archiviato.',
    });
  // 2. Gather everything that happened.
  const segs = await segments(uid, inspectionId);
  const transcript = segs.map(s => s.text).join('\n');
  const portal = await db()
    .prepare(
      'SELECT e.kind,e.created,e.data FROM portal_events e JOIN visits v ON e.visit_id=v.id WHERE v.owner=? AND v.inspection_id=? ORDER BY e.created',
    )
    .bind(uid, inspectionId)
    .all<any>();
  const notes = await db()
    .prepare(
      "SELECT data,created FROM records WHERE owner=? AND kind='event' AND json_extract(data,'$.inspectionId')=? ORDER BY created",
    )
    .bind(uid, inspectionId)
    .all<any>();
  const identity = visits.results[0] ? JSON.parse(visits.results[0].data || '{}') : null;
  const profileRow = await db().prepare('SELECT data FROM profiles WHERE owner=?').bind(uid).first<any>();
  const profile = profileRow ? JSON.parse(profileRow.data) : defaultProfile;
  let audio: any = null;
  if (audioEventId) {
    const ev = await db()
      .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='event'")
      .bind(audioEventId, uid)
      .first<any>();
    const fileId = ev ? JSON.parse(ev.data).fileId : null;
    audio = fileId
      ? await db()
          .prepare('SELECT id,name,sha256 FROM files WHERE id=? AND owner=?')
          .bind(fileId, uid)
          .first<any>()
      : null;
  }
  const input = JSON.stringify({
    fascicolo: ins.data,
    identitaDichiarata: identity,
    portale: portal.results.map((e: any) => ({ tipo: e.kind, ora: e.created, dati: JSON.parse(e.data) })),
    trascrizione: segs.map(s => ({ secondo: Math.round(s.offsetMs / 1000), testo: s.text })),
    annotazioni: notes.results.map((n: any) => ({ ora: n.created, ...JSON.parse(n.data) })),
    documentiInArchivio: await documents(uid),
  }).slice(0, 180000);
  let report;
  try {
    const raw = await responsesJson(ai(), {
      model: REPORT_MODEL,
      instructions: REPORT_INSTRUCTIONS,
      input,
      maxTokens: 6000,
      timeoutMs: 120000,
    });
    report = validateReport(raw, transcript);
  } catch (e) {
    console.error('live report failed', e instanceof Error ? e.message : 'unknown');
    return response({
      closed: true,
      reportId: null,
      error: 'Controllo chiuso. Il rapporto IA non è riuscito: puoi rigenerarlo.',
    });
  }
  // 3. Archive the PDF (with its SHA-256) next to the original recording.
  const meta = {
    company: profile.name,
    authority: ins.data.authority,
    officers: ins.data.officers,
    started: ins.data.started,
    ended: now,
    audioSha256: audio?.sha256,
    audioName: audio?.name,
    segments: segs.length,
    model: REPORT_MODEL,
  };
  const pdf = textPdf(
    reportBlocks(report, meta),
    `Blindo Service · ${profile.name} · rapporto del ${now.slice(0, 10)}`,
  );
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pdf)), x =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  let pdfFileId: string | null = null;
  if (env.BUCKET) {
    pdfFileId = crypto.randomUUID();
    const key = uid + '/' + pdfFileId;
    const name = `rapporto-controllo-${now.slice(0, 10)}.pdf`;
    await env.BUCKET.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    await db()
      .prepare('INSERT INTO files(id,owner,name,mime,object_key,sha256,created) VALUES(?,?,?,?,?,?,?)')
      .bind(pdfFileId, uid, name, 'application/pdf', key, sha256, now)
      .run();
  }
  const reportId = await save(uid, 'report', {
    inspectionId,
    ...report,
    meta,
    audioFileId: audio?.id || null,
    pdfFileId,
    pdfSha256: sha256,
    model: REPORT_MODEL,
    generatedAt: now,
  });
  return response({ closed: true, reportId, pdfFileId });
}

export async function POST(req: Request) {
  try {
    if (req.headers.get('origin') !== new URL(req.url).origin)
      return response({ error: 'Origine non valida' }, 403);
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    const type = req.headers.get('content-type') || '';
    if (type.startsWith('multipart/form-data')) {
      if (!env.OPENAI_API_KEY) return response({ error: 'Servizio IA non collegato' }, 503);
      return await onSegment(req, user.userId);
    }
    if (type.startsWith('application/json')) return await onFinish(req, user.userId);
    return response({ error: 'Formato non valido' }, 415);
  } catch (e) {
    if (e instanceof z.ZodError) return response({ error: 'Dati non validi' }, 400);
    console.error('live failed', e instanceof Error ? e.message : 'unknown');
    return failure(e);
  }
}

/** Live feed for the monitor: transcript segments and hints after a given sequence number. */
export async function GET(req: Request) {
  try {
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    const url = new URL(req.url);
    const inspectionId = z.string().max(100).parse(url.searchParams.get('inspectionId'));
    const rows = await db()
      .prepare(
        "SELECT id,kind,data,created FROM records WHERE owner=? AND kind IN ('live_segment','live_hint','report') AND json_extract(data,'$.inspectionId')=? ORDER BY created",
      )
      .bind(user.userId, inspectionId)
      .all<any>();
    return response({ items: rows.results.map((r: any) => ({ ...r, data: JSON.parse(r.data) })) });
  } catch (e) {
    return failure(e);
  }
}
