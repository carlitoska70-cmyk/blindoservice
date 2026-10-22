// Hourly link with the software centrale of Gionti Holding (Kassaro OS).
// - POST /api/holding/segnale: summary of deadlines, inspections, portal and what is still to complete.
// - GET /api/holding/evidenze: what the management software already covers (HACCP, invoices, allergens…),
//   saved as one 'evidence' record so the catalogue and the inspector portal can show it.
// It runs only when the Worker has the HOLDING_SEGNALE_KEY secret: copies given to other businesses
// never get it, so none of their data leaves their archive. Only counts and titles go out: no
// attachments, no inspector data (names, ranks, plates, references), no free-text outcomes, no
// profile values (only the names of the fields still empty).
// Self-contained (no imports) so the Node tests can load it directly.

export const HOLDING_URL = 'https://kassaro-os.onrender.com/api/holding/segnale';
/** The centrale refuses `dati` above 16 384 characters: stay below with a margin, counted in bytes. */
export const MAX_BYTES = 16_000;
/** Documents expiring within this many days are "in scadenza". */
export const WINDOW_DAYS = 30;
/** Concluded inspections are "recenti" for this many days. */
export const RECENT_DAYS = 90;
const MAX_ITEMS = 25;
const MAX_TITLE = 120;
const TIMEOUT_MS = 30_000;

export type HoldingRecord = { id?: string; kind: string; data: any; created?: string };
/** One active employee as lib/staff.ts staffSummary() returns it. */
export type StaffLine = { name: string; role?: string; missing: string[]; expiring: string[] };
export type StaffSummarize = (
  employees: { id: string; data: any }[],
  docs: { id: string; data: any }[],
  today: string,
) => StaffLine[];
export type CatalogueTitle = { id: string; title: string };
export type EvidenceItem = {
  categoria: string;
  catalogo: string;
  stato: 'presente' | 'parziale' | 'assente';
  dettaglio: string;
  ultimo?: string;
  sezione?: string;
};
export type Evidence = {
  fonte: string;
  versione: string;
  generato: string;
  /** When Blindo saved it: the last successful read, shown when the centrale is unreachable. */
  salvato: string;
  base: string;
  riepilogo: { presenti: number; parziali: number; assenti: number };
  voci: EvidenceItem[];
  pagina_controlli: { attiva: boolean; url?: string; scade?: string | null };
};
export type HoldingMeta = {
  version: string;
  /** Cloudflare version metadata of the running deployment, when bound. */
  release?: { id?: string; timestamp?: string };
  now: Date;
  /** lib/staff.ts staffSummary, passed in by the Worker so this module stays free of imports. */
  staffSummary?: StaffSummarize;
};
export type HoldingSignal = {
  stato: 'ok' | 'attenzione' | 'errore';
  testo: string;
  dati: Record<string, unknown>;
};
type HoldingEnv = { DB?: D1Database; HOLDING_SEGNALE_KEY?: string; HOLDING_URL?: string };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const romeDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const clip = (v: unknown, max = MAX_TITLE) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A YYYY-MM-DD day: dates stay as they are, timestamps become the day in Italy. */
function day(v: unknown) {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return isNaN(t) ? null : romeDay(new Date(t));
}
function daysBetween(today: string, date: string) {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
/** Same rule as normalized() in lib/catalogue-matching.ts: titles match regardless of accents and case. */
export const normalizedTitle = (v: unknown) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const EVIDENCE_STATES = ['presente', 'parziale', 'assente'];
const isoOrNull = (v: unknown) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? v.slice(0, 40) : null);

/** Validates the centrale's evidence: anything unexpected is dropped, links stay on its own origin. */
export function parseEvidence(raw: unknown, savedAt: Date): Evidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  const base = holdingTarget(r.base) ? new URL(r.base).origin : null;
  if (!base || !Array.isArray(r.voci)) return null;
  const voci: EvidenceItem[] = r.voci.slice(0, 100).flatMap((v: any) => {
    if (!v || typeof v.catalogo !== 'string' || !EVIDENCE_STATES.includes(v.stato)) return [];
    const ultimo = typeof v.ultimo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.ultimo) ? v.ultimo : '';
    const sezione = typeof v.sezione === 'string' && /^\/(?!\/)\S{0,199}$/.test(v.sezione) ? v.sezione : '';
    return [
      {
        categoria: clip(v.categoria, 100),
        catalogo: clip(v.catalogo, 200),
        stato: v.stato,
        dettaglio: clip(v.dettaglio, 400),
        ...(ultimo ? { ultimo } : {}),
        ...(sezione ? { sezione } : {}),
      },
    ];
  });
  const p = r.pagina_controlli || {};
  let page: Evidence['pagina_controlli'] = { attiva: false };
  try {
    if (p.attiva === true && typeof p.url === 'string' && new URL(p.url).origin === base)
      page = { attiva: true, url: new URL(p.url).toString(), scade: isoOrNull(p.scade) };
  } catch {}
  const count = (s: string) => voci.filter(v => v.stato === s).length;
  return {
    fonte: 'Kassaro OS',
    versione: clip(r.versione, 40),
    generato: isoOrNull(r.generato) || savedAt.toISOString(),
    salvato: savedAt.toISOString(),
    base,
    riepilogo: { presenti: count('presente'), parziali: count('parziale'), assenti: count('assente') },
    voci,
    pagina_controlli: page,
  };
}

/** Link to the management software for one evidence item. */
export const evidenceLink = (e: Pick<Evidence, 'base'>, v: EvidenceItem) =>
  v.sezione ? e.base + v.sezione : null;

/** The HACCP page to offer an authorised inspector, while its link is valid. */
export function controlPage(e: Evidence | null | undefined, now: Date) {
  const p = e?.pagina_controlli;
  if (!p?.attiva || !p.url) return null;
  if (p.scade && Date.parse(p.scade) <= now.getTime()) return null;
  return { url: p.url, scade: p.scade || null };
}

const PROFILE_FIELDS: [string, string][] = [
  ['name', 'Nome dell’attività'],
  ['legalName', 'Ragione sociale'],
  ['vat', 'Partita IVA'],
  ['address', 'Indirizzo'],
  ['city', 'Comune'],
  ['region', 'Regione'],
  ['activity', 'Attività svolta'],
  ['reviewer', 'Revisore (legale o consulente)'],
  ['portalNotice', 'Informativa del portale'],
];
const PLACEHOLDER = /^(ciao|test|prova|x+|todo|da (completare|inserire|definire)|\.+|-+|n\/?a)$/i;
/** The portal can be switched on only with a notice of at least this length (app/api/portal). */
const MIN_NOTICE = 120;

/** Names of the profile fields still empty or holding a placeholder. Values never leave Blindo. */
export function profileGaps(profile: any) {
  const mancanti: string[] = [],
    segnaposto: string[] = [],
    da_confermare: string[] = [];
  for (const [key, label] of PROFILE_FIELDS) {
    const v = String(profile?.[key] ?? '').trim();
    if (!v) mancanti.push(label);
    else if (PLACEHOLDER.test(v) || (key === 'portalNotice' && v.length < MIN_NOTICE)) segnaposto.push(label);
  }
  if (profile?.staff === 'Da confermare') da_confermare.push('Personale dipendente');
  if (profile?.dehors === 'Da confermare') da_confermare.push('Dehors');
  return { mancanti, segnaposto, da_confermare };
}

const catalogLinks = (d: any) =>
  [d?.catalogId, ...(Array.isArray(d?.catalogIds) ? d.catalogIds : [])].filter(
    (x): x is string => typeof x === 'string' && !!x.trim(),
  );

/** Builds the signal from the owner's records. Pure: the caller supplies records and the clock. */
export function holdingSummary(
  input: HoldingMeta & {
    owner: boolean;
    records: HoldingRecord[];
    portalEnabled: boolean;
    profile?: any;
    catalogue?: CatalogueTitle[];
  },
): HoldingSignal {
  const today = romeDay(input.now);
  const live = input.records.filter(r => r.data && typeof r.data === 'object' && !r.data.archivedAt);

  const documents = live.filter(r => r.kind === 'document');
  const dated = documents
    .map(r => ({ titolo: clip(r.data.title), data: day(r.data.expires) }))
    .filter((x): x is { titolo: string; data: string } => !!x.data)
    .map(x => ({ ...x, giorni: daysBetween(today, x.data) }))
    .sort((a, b) => a.giorni - b.giorni);
  const expired = dated.filter(x => x.giorni < 0);
  const expiring = dated.filter(x => x.giorni >= 0 && x.giorni <= WINDOW_DAYS);

  const inspections = live
    .filter(r => r.kind === 'inspection')
    .map(r => ({
      ente: clip(r.data.authority),
      oggetto: clip(r.data.scope),
      stato: r.data.status === 'aperto' ? 'aperto' : 'concluso',
      iniziato_il: day(r.data.started) || day(r.created),
      concluso_il: r.data.status === 'aperto' ? null : day(r.data.ended),
    }))
    .sort((a, b) => (b.iniziato_il || '').localeCompare(a.iniziato_il || ''));
  const open = inspections.filter(x => x.stato === 'aperto');
  const recent = inspections.filter(x => {
    const last = x.concluso_il || x.iniziato_il;
    return x.stato === 'concluso' && !!last && daysBetween(last, today) <= RECENT_DAYS;
  });

  // What is still to complete, so the Director sees the gaps.
  const unchecked = documents.filter(r => !r.data.reviewed);
  const unlinked = documents.filter(r => !catalogLinks(r.data).length);
  const undated = documents.filter(r => !day(r.data.expires));
  const evidence: Evidence | undefined = live.find(r => r.kind === 'evidence')?.data;
  const decided = new Map<string, string>(
    live.filter(r => r.kind === 'requirement').map(r => [String(r.data.catalogId), String(r.data.status)]),
  );
  const toAssess: { titolo: string; evidenza: string }[] = [];
  for (const v of evidence?.voci || []) {
    if (v.stato === 'assente') continue;
    for (const c of (input.catalogue || []).filter(
      c => normalizedTitle(c.title) === normalizedTitle(v.catalogo),
    ))
      if ((decided.get(c.id) || 'Da valutare') === 'Da valutare')
        toAssess.push({ titolo: clip(c.title), evidenza: v.stato });
  }

  // Employees with documents missing or expiring (names and document labels only, never the files).
  const staff =
    input.owner && input.staffSummary
      ? input.staffSummary(
          live.filter(r => r.kind === 'employee' && r.id).map(r => ({ id: r.id!, data: r.data })),
          documents.filter(r => r.id).map(r => ({ id: r.id!, data: r.data })),
          today,
        )
      : null;
  const staffGaps = (staff || []).filter(e => e.missing.length || e.expiring.length);

  const stato: HoldingSignal['stato'] = !input.owner || expired.length || open.length ? 'attenzione' : 'ok';
  const testo = clip(
    input.owner
      ? [
          expired.length
            ? plural(expired.length, 'documento scaduto', 'documenti scaduti')
            : 'nessun documento scaduto',
          expiring.length
            ? `${expiring.length} in scadenza entro ${WINDOW_DAYS} giorni`
            : `nessuna scadenza entro ${WINDOW_DAYS} giorni`,
          open.length
            ? plural(open.length, 'controllo aperto', 'controlli aperti')
            : 'nessun controllo aperto',
          input.portalEnabled ? 'portale QR attivo' : 'portale QR spento',
        ].join(' · ')
      : 'Nessun titolare configurato in Blindo Service',
    200,
  );

  const titles = (rows: HoldingRecord[]) => rows.slice(0, MAX_ITEMS).map(r => clip(r.data.title));
  const lists: Record<string, unknown[]> = {
    documenti_scaduti: expired
      .slice(0, MAX_ITEMS)
      .map(x => ({ titolo: x.titolo, scaduto_il: x.data, da_giorni: -x.giorni })),
    documenti_in_scadenza: expiring
      .slice(0, MAX_ITEMS)
      .map(x => ({ titolo: x.titolo, scade_il: x.data, tra_giorni: x.giorni })),
    controlli_elenco: [...open, ...recent].slice(0, MAX_ITEMS),
    documenti_da_verificare: titles(unchecked),
    documenti_senza_catalogo: titles(unlinked),
    documenti_senza_scadenza: titles(undated),
    requisiti_coperti_da_valutare: toAssess.slice(0, MAX_ITEMS),
    personale_con_mancanze: staffGaps.slice(0, MAX_ITEMS).map(e => ({
      nome: clip(e.name),
      ...(e.role ? { mansione: clip(e.role) } : {}),
      mancano: e.missing.slice(0, 12).map(x => clip(x)),
      in_scadenza: e.expiring.slice(0, 12).map(x => clip(x)),
    })),
  };
  const cut = [
    expired,
    expiring,
    [...open, ...recent],
    unchecked,
    unlinked,
    undated,
    toAssess,
    staffGaps,
  ].some(l => l.length > MAX_ITEMS);
  const assemble = (l: Record<string, unknown[]>) => ({
    software: 'blindo',
    versione: input.version,
    ...(input.release?.timestamp ? { rilascio: input.release.timestamp } : {}),
    generato: input.now.toISOString(),
    oggi: today,
    // The centrale rewrites stato/testo of online software at every 5-minute check: keep them here too.
    riepilogo: { stato, testo },
    documenti: {
      attivi: documents.length,
      scaduti: expired.length,
      in_scadenza: expiring.length,
      entro_giorni: WINDOW_DAYS,
    },
    controlli: {
      aperti: open.length,
      recenti: recent.length,
      recenti_giorni: RECENT_DAYS,
      ultimo_il: inspections[0]?.iniziato_il || null,
    },
    portale_qr: { attivo: input.portalEnabled },
    documenti_scaduti: l.documenti_scaduti,
    documenti_in_scadenza: l.documenti_in_scadenza,
    controlli_elenco: l.controlli_elenco,
    ...(staff
      ? {
          personale: {
            attivi: staff.length,
            completi: staff.length - staffGaps.length,
            con_mancanze: l.personale_con_mancanze,
            nota: 'Elenco generico per un bar-ristorante: cosa serve davvero dipende da contratto, DVR e mansione.',
          },
        }
      : {}),
    ...(input.owner
      ? {
          da_completare: {
            profilo: profileGaps(input.profile),
            documenti: {
              da_verificare: unchecked.length,
              senza_catalogo: unlinked.length,
              senza_scadenza: undated.length,
              nota: 'Senza scadenza vuol dire data non indicata nella scheda: va letta sull’originale, non è validità illimitata.',
            },
            requisiti_coperti_da_valutare: toAssess.length,
            evidenze_gestionale: evidence ? { lette_il: evidence.salvato, ...evidence.riepilogo } : null,
            elenchi: {
              documenti_da_verificare: l.documenti_da_verificare,
              documenti_senza_catalogo: l.documenti_senza_catalogo,
              documenti_senza_scadenza: l.documenti_senza_scadenza,
              requisiti_coperti_da_valutare: l.requisiti_coperti_da_valutare,
            },
          },
        }
      : {}),
  });
  const fit = fitSize(lists, assemble);
  return { stato, testo, dati: { ...fit.dati, elenchi_completi: !cut && !fit.trimmed } };
}

/** Drops items from the longest list until the JSON fits the centrale's limit. Counts stay exact. */
function fitSize(
  lists: Record<string, unknown[]>,
  assemble: (l: Record<string, unknown[]>) => Record<string, unknown>,
) {
  let trimmed = false;
  while (bytes(assemble(lists)) > MAX_BYTES) {
    const longest = Object.keys(lists).reduce((a, b) => (lists[b].length > lists[a].length ? b : a));
    if (!lists[longest].length) break;
    lists[longest] = lists[longest].slice(0, -1);
    trimmed = true;
  }
  return { dati: assemble(lists), trimmed };
}

/** Only HTTPS, or plain HTTP on loopback for local tests: the key never travels in clear. */
export function holdingTarget(url?: string) {
  try {
    const u = new URL(url || HOLDING_URL);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return u.protocol === 'https:' || (u.protocol === 'http:' && loopback) ? u.toString() : null;
  } catch {
    return null;
  }
}

const ownerOf = async (db: D1Database) =>
  (await db.prepare('SELECT owner FROM admin_identity WHERE slot=1').first<{ owner: string }>())?.owner ||
  null;

/** Reads the owner's archive (the single titolare of this copy) and builds the signal. */
export async function collectHolding(
  db: D1Database,
  meta: HoldingMeta,
  catalogue: CatalogueTitle[] = [],
): Promise<HoldingSignal> {
  const owner = await ownerOf(db);
  if (!owner) return holdingSummary({ ...meta, owner: false, records: [], portalEnabled: false });
  const [r, p, profile] = await Promise.all([
    db
      .prepare(
        "SELECT id,kind,data,created FROM records WHERE owner=? AND kind IN ('document','inspection','requirement','evidence','employee')",
      )
      .bind(owner)
      .all<{ id: string; kind: string; data: string; created: string }>(),
    db.prepare('SELECT enabled FROM portals WHERE owner=?').bind(owner).first<{ enabled: number }>(),
    db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<{ data: string }>(),
  ]);
  const parse = (v?: string) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const records = r.results.map(x => ({ id: x.id, kind: x.kind, data: parse(x.data), created: x.created }));
  return holdingSummary({
    ...meta,
    owner: true,
    records,
    portalEnabled: !!p?.enabled,
    profile: parse(profile?.data) || {},
    catalogue,
  });
}

function failure(testo: string, meta: HoldingMeta): HoldingSignal {
  return {
    stato: 'errore',
    testo,
    dati: {
      software: 'blindo',
      versione: meta.version,
      generato: meta.now.toISOString(),
      riepilogo: { stato: 'errore', testo },
    },
  };
}
const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'User-Agent': 'BlindoService-holding',
});
const unreachable = (err: unknown) =>
  err instanceof Error && err.name === 'TimeoutError'
    ? 'La centrale non risponde'
    : 'Centrale non raggiungibile';

/**
 * Sends the signal. Never throws: a failure is only logged, and the site keeps working as before.
 * Without HOLDING_SEGNALE_KEY nothing is read and nothing is sent.
 */
export async function sendHolding(
  env: HoldingEnv,
  meta: HoldingMeta,
  fetchImpl: Fetch = fetch,
  catalogue: CatalogueTitle[] = [],
) {
  const key = (env.HOLDING_SEGNALE_KEY || '').trim();
  if (!key) return { sent: false, reason: 'Chiave della holding non configurata' };
  const url = holdingTarget(env.HOLDING_URL);
  if (!url) return { sent: false, reason: 'Indirizzo della holding non valido' };
  let signal: HoldingSignal;
  try {
    signal = env.DB
      ? await collectHolding(env.DB, meta, catalogue)
      : failure('Archivio non disponibile', meta);
  } catch {
    signal = failure('Archivio non leggibile', meta);
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers(key), 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { sent: false, status: res.status, reason: `La centrale risponde ${res.status}` };
    return { sent: true, status: res.status, stato: signal.stato };
  } catch (err) {
    return { sent: false, reason: unreachable(err) };
  }
}

/**
 * Reads the management software's evidence and saves it as the owner's 'evidence' record.
 * On any failure the last saved evidence stays, with its date. Never throws.
 */
export async function syncEvidence(env: HoldingEnv, now: Date, fetchImpl: Fetch = fetch) {
  const key = (env.HOLDING_SEGNALE_KEY || '').trim();
  const target = holdingTarget(env.HOLDING_URL);
  if (!key || !target || !env.DB) return { saved: false, reason: 'Collegamento non configurato' };
  try {
    const owner = await ownerOf(env.DB);
    if (!owner) return { saved: false, reason: 'Nessun titolare configurato' };
    const res = await fetchImpl(new URL('evidenze', target).toString(), {
      method: 'GET',
      headers: headers(key),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { saved: false, status: res.status, reason: `La centrale risponde ${res.status}` };
    const evidence = parseEvidence(await res.json().catch(() => null), now);
    if (!evidence) return { saved: false, reason: 'Evidenze non valide (serve Kassaro OS 8.3.0)' };
    const at = now.toISOString();
    await env.DB.prepare(
      "INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,'evidence',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.kind='evidence'",
    )
      .bind(`evidenze:${owner}`, owner, JSON.stringify(evidence), at, at)
      .run();
    return { saved: true, voci: evidence.voci.length };
  } catch (err) {
    const network = err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError');
    return { saved: false, reason: network ? unreachable(err) : 'Salvataggio non riuscito' };
  }
}

/** The hourly run: evidence first, so the signal's da_completare uses the fresh reading. */
export async function runHolding(
  env: HoldingEnv,
  meta: HoldingMeta,
  catalogue: CatalogueTitle[],
  fetchImpl: Fetch = fetch,
) {
  if (!(env.HOLDING_SEGNALE_KEY || '').trim())
    return { segnale: { sent: false, reason: 'Chiave della holding non configurata' } };
  const evidenze = await syncEvidence(env, meta.now, fetchImpl);
  const segnale = await sendHolding(env, meta, fetchImpl, catalogue);
  return { evidenze, segnale };
}
