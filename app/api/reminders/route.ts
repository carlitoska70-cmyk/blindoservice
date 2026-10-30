import { env } from 'cloudflare:workers';
import { getMember } from '@/lib/operator';
import { channels } from '@/lib/notify';
import { phones } from '@/lib/push';
import { dueItems, romeToday, type ReminderRecord } from '@/lib/reminders';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
type Env = Record<string, string | undefined>;

async function load(db: D1Database, owner: string) {
  const r = await db
    .prepare("SELECT id,kind,data FROM records WHERE owner=? AND kind IN ('document','task')")
    .bind(owner)
    .all<{ id: string; kind: string; data: string }>();
  const records: ReminderRecord[] = r.results.map(x => ({ ...x, data: JSON.parse(x.data) }));
  return { records };
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
    // The daily reminders run from the Worker Cron (lib/reminders-job.ts) from 08:00 in Rome.
    channels: {
      ...channels(e),
      push: await phones(env.DB, user.userId),
      scheduled: true,
    },
  });
}
