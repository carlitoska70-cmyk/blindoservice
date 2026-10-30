// The owner's phones subscribed to Blindo's own notifications: every merchant's copy can ring its owner
// when an inspector arrives, without Gionti Holding. VAPID keys are created once and kept in the database.
import { newVapidKeys, sendPush, type PushPayload, type Subscription, type VapidKeys } from './webpush';

type Fetch = typeof fetch;

/** The copy's VAPID keys (created on first use) and the origin used as VAPID subject. */
export async function vapidKeys(db: D1Database, origin?: string): Promise<VapidKeys & { subject: string }> {
  let row = await db.prepare('SELECT public_key, private_jwk, origin FROM push_keys WHERE id=1').first<any>();
  if (!row) {
    const k = await newVapidKeys();
    await db
      .prepare('INSERT OR IGNORE INTO push_keys(id,public_key,private_jwk,origin,created) VALUES(1,?,?,?,?)')
      .bind(k.publicKey, JSON.stringify(k.privateJwk), origin || '', new Date().toISOString())
      .run();
    row = await db.prepare('SELECT public_key, private_jwk, origin FROM push_keys WHERE id=1').first<any>();
  } else if (origin && !row.origin) {
    await db.prepare('UPDATE push_keys SET origin=? WHERE id=1').bind(origin).run();
    row.origin = origin;
  }
  return {
    publicKey: row.public_key,
    privateJwk: JSON.parse(row.private_jwk),
    subject:
      row.origin && /^https:\/\//.test(row.origin) ? row.origin : 'mailto:assistenza@blindoservice.app',
  };
}

export async function subscribePhone(db: D1Database, owner: string, sub: Subscription, userAgent = '') {
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO push_subscriptions(id,owner,endpoint,p256dh,auth,user_agent,created,active) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(endpoint) DO UPDATE SET owner=excluded.owner,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,active=1,last_error=NULL',
    )
    .bind(crypto.randomUUID(), owner, sub.endpoint, sub.p256dh, sub.auth, userAgent.slice(0, 200), now)
    .run();
}

export async function unsubscribePhone(db: D1Database, owner: string, endpoint: string) {
  await db.prepare('DELETE FROM push_subscriptions WHERE owner=? AND endpoint=?').bind(owner, endpoint).run();
}

export async function phones(db: D1Database, owner: string) {
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner=? AND active=1')
    .bind(owner)
    .first<{ n: number }>();
  return r?.n || 0;
}

/** Rings every phone of the owner. Never throws: a failed phone is marked, a vanished one is dropped. */
export async function notifyPhones(
  db: D1Database,
  owner: string,
  payload: PushPayload,
  fetchImpl: Fetch = fetch,
) {
  const report = { sent: 0, phones: 0 };
  try {
    const subs = await db
      .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner=? AND active=1')
      .bind(owner)
      .all<any>();
    if (!subs.results.length) return report;
    const keys = await vapidKeys(db);
    for (const s of subs.results) {
      report.phones++;
      try {
        const r = await sendPush(s, payload, keys, keys.subject, fetchImpl);
        if (r.ok) {
          report.sent++;
          await db
            .prepare('UPDATE push_subscriptions SET last_ok=?, last_error=NULL WHERE id=?')
            .bind(new Date().toISOString(), s.id)
            .run();
        } else
          await db
            .prepare(
              'UPDATE push_subscriptions SET last_error=?, active=CASE WHEN ? THEN 0 ELSE active END WHERE id=?',
            )
            .bind('HTTP ' + r.status, r.gone ? 1 : 0, s.id)
            .run();
      } catch (e) {
        await db
          .prepare('UPDATE push_subscriptions SET last_error=? WHERE id=?')
          .bind(String(e instanceof Error ? e.message : e).slice(0, 200), s.id)
          .run();
      }
    }
  } catch (e) {
    console.error('push failed', e instanceof Error ? e.message : 'unknown');
  }
  return report;
}
