import { env } from 'cloudflare:workers';
import { getMember } from '@/lib/operator';
import { defaultProfile } from '@/lib/product';
import { channels, send } from '@/lib/notify';
import { dueItems, notifiable, reminderText, romeToday, type ReminderRecord } from '@/lib/reminders';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
type Env = Record<string, string | undefined>;

async function load(db: D1Database, owner: string) {
  const [p, r] = await Promise.all([
    db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<{ data: string }>(),
    db
      .prepare("SELECT id,kind,data FROM records WHERE owner=? AND kind IN ('document','task')")
      .bind(owner)
      .all<{ id: string; kind: string; data: string }>(),
  ]);
  const profile = p ? JSON.parse(p.data) : defaultProfile;
  const records: ReminderRecord[] = r.results.map(x => ({ ...x, data: JSON.parse(x.data) }));
  return { profile, records };
}

async function sameSecret(a: string, b: string) {
  const enc = (v: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const [x, y] = await Promise.all([enc(a), enc(b)]);
  const u = new Uint8Array(x),
    v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** Owner view: what is due now (all items, not only today's milestones). */
export async function GET() {
  const user = await getMember();
  if (!user) return json({ error: 'Accesso richiesto' }, 401);
  if (!env.DB) return json({ error: 'Archivio non disponibile' }, 503);
  const { records } = await load(env.DB, user.userId);
  const e = env as unknown as Env;
  return json({
    items: dueItems(records, romeToday()),
    channels: {
      ...channels(e),
      scheduled: !!e.PRESIDIO_REMINDER_TOKEN,
    },
  });
}

/**
 * Daily trigger (GitHub Actions cron): Authorization: Bearer PRESIDIO_REMINDER_TOKEN.
 * ?dry=1 returns the message without sending it.
 */
export async function POST(req: Request) {
  const e = env as unknown as Env;
  const expected = e.PRESIDIO_REMINDER_TOKEN || '';
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (expected.length < 32 || !(await sameSecret(given, expected)))
    return json({ error: 'Non autorizzato' }, 401);
  if (!env.DB) return json({ error: 'Archivio non disponibile' }, 503);
  try {
    const identity = await env.DB.prepare('SELECT owner FROM admin_identity WHERE slot=1').first<{
      owner: string;
    }>();
    if (!identity) return json({ sent: false, reason: 'Nessun titolare configurato' });
    const { profile, records } = await load(env.DB, identity.owner);
    const today = romeToday();
    const items = notifiable(dueItems(records, today), today);
    if (!items.length) return json({ sent: false, reason: 'Nulla da segnalare oggi' });
    const text = reminderText(profile.name, items, new URL(req.url).origin);
    if (new URL(req.url).searchParams.get('dry') === '1') return json({ sent: false, dry: true, text });
    const sent = await send(e, `Presidio: ${items.length} scadenze da guardare`, text);
    if (!sent.length) return json({ sent: false, reason: 'Nessun canale configurato', text });
    return json({ sent: true, channels: sent, count: items.length });
  } catch (err) {
    console.error('reminders failed', err instanceof Error ? err.message : 'unknown');
    return json({ error: 'Invio non riuscito' }, 502);
  }
}
