// Daily deadline reminders from the Worker Cron (from 08:00 in Rome, once a day): on the owner's phones
// (Blindo's own notifications) and, where configured, Telegram or email. Replaces the GitHub job.
import { defaultProfile } from './product';
import { send, type NotifyEnv } from './notify';
import { notifyPhones, vapidKeys } from './push';
import { dueItems, notifiable, reminderText, romeToday, when, type ReminderRecord } from './reminders';

type Env = { DB?: D1Database };
const START_HOUR = 8;

const romeHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(
      now,
    ),
  );

/** Hourly from the Cron; sends at most once per day. Never throws. */
export async function runReminders(env: Env, now = new Date(), fetchImpl: typeof fetch = fetch) {
  const db = env.DB;
  if (!db) return { ok: false, error: 'database non disponibile' };
  try {
    const today = romeToday(now);
    if (romeHour(now) < START_HOUR) return { ok: true, saltata: 'prima delle 8' };
    const identity = await db
      .prepare('SELECT owner FROM admin_identity WHERE slot=1')
      .first<{ owner: string }>();
    if (!identity) return { ok: true, saltata: 'nessun titolare' };
    const owner = identity.owner,
      stateId = 'promemoria:' + owner;
    const prev = await db
      .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='reminder_state'")
      .bind(stateId, owner)
      .first<{ data: string }>();
    if (prev && JSON.parse(prev.data).day === today) return { ok: true, saltata: 'già fatto oggi' };
    const [p, r] = await Promise.all([
      db.prepare('SELECT data FROM profiles WHERE owner=?').bind(owner).first<{ data: string }>(),
      db
        .prepare("SELECT id,kind,data FROM records WHERE owner=? AND kind IN ('document','task')")
        .bind(owner)
        .all<{ id: string; kind: string; data: string }>(),
    ]);
    const profile = p ? JSON.parse(p.data) : defaultProfile;
    const records: ReminderRecord[] = r.results.map(x => ({ ...x, data: JSON.parse(x.data) }));
    const items = notifiable(dueItems(records, today), today);
    const iso = now.toISOString();
    const result: Record<string, unknown> = { scadenze: items.length };
    if (items.length) {
      const phones = await notifyPhones(
        db,
        owner,
        {
          title: items.length === 1 ? 'Una scadenza da guardare' : `${items.length} scadenze da guardare`,
          body: items
            .slice(0, 3)
            .map(x => `${x.title}: ${when(x.days)}`)
            .join(' · '),
          url: '/',
          tag: 'blindo-scadenze',
        },
        fetchImpl,
      );
      const keys = await vapidKeys(db);
      const origin = keys.subject.startsWith('https://') ? keys.subject : '';
      const sent = await send(
        env as unknown as NotifyEnv,
        `Blindo Service: ${items.length} scadenze da guardare`,
        reminderText(profile.name, items, origin || 'Blindo Service'),
      ).catch(() => []);
      Object.assign(result, { telefoni: phones.sent, altri: sent });
    }
    await db
      .prepare(
        "INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,'reminder_state',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated",
      )
      .bind(stateId, owner, JSON.stringify({ day: today, ...result }), iso, iso)
      .run();
    return { ok: true, ...result };
  } catch (e) {
    console.error('reminders job failed', e instanceof Error ? e.message : 'unknown');
    return { ok: false, error: 'promemoria non riusciti' };
  }
}
