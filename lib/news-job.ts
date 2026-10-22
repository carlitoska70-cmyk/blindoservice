// Weekly search of the news from associations and public bodies. The Worker Cron runs it once per
// week from Monday 08:00 (Rome); «Cerca novità ora» runs it on demand and counts as that week's run.
// A failed attempt is retried after RETRY_HOURS, so a broken key does not cost a call every hour.
import { responsesJson } from './openai';
import { NEWS_INSTRUCTIONS, NEWS_MODEL, newsKey, parseNews } from './news';
import { send, type NotifyEnv } from './notify';

const DAY = 86_400_000;
export const RETRY_HOURS = 6;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Env = { DB?: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string };
export type NewsState = { lastRun?: string; lastAttempt?: string; last?: unknown };
export const newsStateId = (owner: string) => 'novita:' + owner;

/** The news week of a moment, as the date of its Monday: a week starts on Monday at 08:00 in Rome. */
export function newsWeek(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(at)
      .map(x => [x.type, x.value]),
  );
  const back = WEEKDAYS.indexOf(p.weekday) + (p.weekday === 'Mon' && Number(p.hour) < 8 ? 7 : 0);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - back * DAY).toISOString().slice(0, 10);
}

/** Whether the automatic search is due: once per news week, and not right after a failed attempt. */
export function newsDue(now: Date, s: NewsState | null) {
  if (s?.lastRun && newsWeek(new Date(s.lastRun)) === newsWeek(now)) return false;
  if (s?.lastAttempt && now.getTime() - Date.parse(s.lastAttempt) < RETRY_HOURS * 3600_000) return false;
  return true;
}

async function readState(db: D1Database, owner: string): Promise<NewsState | null> {
  const r = await db
    .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='news_state'")
    .bind(newsStateId(owner), owner)
    .first<{ data: string }>();
  try {
    return r ? JSON.parse(r.data) : null;
  } catch {
    return null;
  }
}

async function writeState(db: D1Database, owner: string, state: NewsState, now: string) {
  await db
    .prepare(
      "INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,'news_state',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated",
    )
    .bind(newsStateId(owner), owner, JSON.stringify(state), now, now)
    .run();
}

/** Searches the web (allowed sources only), stores new items, alerts on high relevance. Throws on failure. */
export async function searchNews(env: Env, owner: string, now = new Date(), origin = '') {
  const db = env.DB!;
  const known = await db
    .prepare("SELECT json_extract(data,'$.key') AS k FROM records WHERE owner=? AND kind='news'")
    .bind(owner)
    .all<{ k: string }>();
  const profile = await db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<any>();
  const raw = await responsesJson(
    { key: env.OPENAI_API_KEY!, base: env.OPENAI_BASE_URL },
    {
      model: NEWS_MODEL,
      instructions: NEWS_INSTRUCTIONS,
      input: JSON.stringify({
        oggi: now.toISOString().slice(0, 10),
        attivita: profile ? JSON.parse(profile.data).activity || 'Bar e ristorazione' : 'Bar e ristorazione',
        citta: 'Palermo',
      }),
      maxTokens: 5000,
      timeoutMs: 150000,
      webSearch: true,
    },
  );
  const { items, discarded } = parseNews(raw, new Set(known.results.map((r: { k: string }) => r.k)));
  const iso = now.toISOString();
  for (const n of items)
    await db
      .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
      .bind(
        crypto.randomUUID(),
        owner,
        'news',
        JSON.stringify({ ...n, key: newsKey(n.url), stato: 'nuova', model: NEWS_MODEL }),
        iso,
        iso,
      )
      .run();
  const important = items.filter(n => n.rilevanza === 'alta');
  const result = { nuove: items.length, importanti: important.length, scartate: discarded };
  await writeState(db, owner, { lastRun: iso, lastAttempt: iso, last: result }, iso);
  if (important.length)
    await send(
      env as unknown as NotifyEnv,
      `Blindo Service: ${important.length} novità importanti`,
      [
        'NOVITÀ DA ASSOCIAZIONI ED ENTI',
        ...important.map(
          n => `• ${n.titolo} (${n.fonte})${n.scadenza ? ' — scadenza ' + n.scadenza : ''}\n  ${n.url}`,
        ),
        origin ? `Apri Blindo Service › Norme: ${origin}/` : 'Apri Blindo Service › Norme.',
      ].join('\n'),
    ).catch(() => {});
  return result;
}

/** Hourly from the Worker Cron; searches only when due. Never throws. */
export async function runNews(env: Env, now = new Date()) {
  const db = env.DB;
  if (!db) return { ok: false, error: 'database non disponibile' };
  if (!env.OPENAI_API_KEY) return { ok: true, saltata: 'IA non collegata' };
  try {
    const identity = await db
      .prepare('SELECT owner FROM admin_identity WHERE slot=1')
      .first<{ owner: string }>();
    if (!identity) return { ok: true, saltata: 'nessun titolare' };
    const prev = await readState(db, identity.owner);
    if (!newsDue(now, prev)) return { ok: true, saltata: 'non è il momento' };
    await writeState(db, identity.owner, { ...prev, lastAttempt: now.toISOString() }, now.toISOString());
    return { ok: true, ...(await searchNews(env, identity.owner, now)) };
  } catch (e) {
    console.error('news job failed', e instanceof Error ? e.message : 'unknown');
    return { ok: false, error: 'ricerca non riuscita' };
  }
}
