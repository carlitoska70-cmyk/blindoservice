// Hourly summary for the software centrale of Gionti Holding (Kassaro OS, POST /api/holding/segnale).
// It runs only when the Worker has the HOLDING_SEGNALE_KEY secret: copies given to other businesses
// never get it, so none of their data leaves their archive. Only counts and titles go out: no
// attachments, no inspector data (names, ranks, plates, offices, references), no free-text outcomes.
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

export type HoldingRecord = { kind: string; data: any; created?: string };
export type HoldingMeta = {
  version: string;
  /** Cloudflare version metadata of the running deployment, when bound. */
  release?: { id?: string; timestamp?: string };
  now: Date;
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

/** Builds the signal from the owner's records. Pure: the caller supplies records and the clock. */
export function holdingSummary(
  input: HoldingMeta & { owner: boolean; records: HoldingRecord[]; portalEnabled: boolean },
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

  const lists: Record<string, unknown[]> = {
    documenti_scaduti: expired
      .slice(0, MAX_ITEMS)
      .map(x => ({ titolo: x.titolo, scaduto_il: x.data, da_giorni: -x.giorni })),
    documenti_in_scadenza: expiring
      .slice(0, MAX_ITEMS)
      .map(x => ({ titolo: x.titolo, scade_il: x.data, tra_giorni: x.giorni })),
    controlli_elenco: [...open, ...recent].slice(0, MAX_ITEMS),
  };
  const cut =
    expired.length > MAX_ITEMS || expiring.length > MAX_ITEMS || open.length + recent.length > MAX_ITEMS;
  const base = {
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
  };
  const fit = fitSize(base, lists);
  return { stato, testo, dati: { ...fit.dati, elenchi_completi: !cut && !fit.trimmed } };
}

/** Drops items from the longest list until the JSON fits the centrale's limit. Counts stay exact. */
function fitSize(base: Record<string, unknown>, lists: Record<string, unknown[]>) {
  let trimmed = false;
  while (bytes({ ...base, ...lists }) > MAX_BYTES) {
    const longest = Object.keys(lists).reduce((a, b) => (lists[b].length > lists[a].length ? b : a));
    if (!lists[longest].length) break;
    lists[longest] = lists[longest].slice(0, -1);
    trimmed = true;
  }
  return { dati: { ...base, ...lists }, trimmed };
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

/** Reads the owner's archive (the single titolare of this copy) and builds the signal. */
export async function collectHolding(db: D1Database, meta: HoldingMeta): Promise<HoldingSignal> {
  const identity = await db
    .prepare('SELECT owner FROM admin_identity WHERE slot=1')
    .first<{ owner: string }>();
  if (!identity) return holdingSummary({ ...meta, owner: false, records: [], portalEnabled: false });
  const [r, p] = await Promise.all([
    db
      .prepare("SELECT kind,data,created FROM records WHERE owner=? AND kind IN ('document','inspection')")
      .bind(identity.owner)
      .all<{ kind: string; data: string; created: string }>(),
    db.prepare('SELECT enabled FROM portals WHERE owner=?').bind(identity.owner).first<{ enabled: number }>(),
  ]);
  const records = r.results.map(x => {
    try {
      return { kind: x.kind, data: JSON.parse(x.data), created: x.created };
    } catch {
      return { kind: x.kind, data: null, created: x.created };
    }
  });
  return holdingSummary({ ...meta, owner: true, records, portalEnabled: !!p?.enabled });
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

/**
 * Sends the signal. Never throws: a failure is only logged, and the site keeps working as before.
 * Without HOLDING_SEGNALE_KEY nothing is read and nothing is sent.
 */
export async function sendHolding(env: HoldingEnv, meta: HoldingMeta, fetchImpl: Fetch = fetch) {
  const key = (env.HOLDING_SEGNALE_KEY || '').trim();
  if (!key) return { sent: false, reason: 'Chiave della holding non configurata' };
  const url = holdingTarget(env.HOLDING_URL);
  if (!url) return { sent: false, reason: 'Indirizzo della holding non valido' };
  let signal: HoldingSignal;
  try {
    signal = env.DB ? await collectHolding(env.DB, meta) : failure('Archivio non disponibile', meta);
  } catch {
    signal = failure('Archivio non leggibile', meta);
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BlindoService-holding',
      },
      body: JSON.stringify(signal),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { sent: false, status: res.status, reason: `La centrale risponde ${res.status}` };
    return { sent: true, status: res.status, stato: signal.stato };
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    return { sent: false, reason: timeout ? 'La centrale non risponde' : 'Centrale non raggiungibile' };
  }
}
