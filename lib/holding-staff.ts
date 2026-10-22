// The staff of the management software (Kassaro OS, the holding's centrale) reaches the employee
// registry as proposals «da Gionti Suite»: GET /api/holding/operatori with the same key as the hourly
// signal. Nothing enters the registry until the owner accepts; an unchanged person is not proposed
// again, a changed one goes back to the owner. People who leave are never removed from here.
import { PROPOSAL_SCHEMAS } from './integration';
import { holdingTarget } from './holding';

type Env = { DB?: D1Database; HOLDING_SEGNALE_KEY?: string; HOLDING_URL?: string };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Same name as a program's key, so documents and staff from Gionti Suite end up together. */
export const STAFF_SOURCE = 'Gionti Suite';
const MAX_PEOPLE = 200;
const TIMEOUT_MS = 10_000;

/** Validates the centrale's answer: only well-formed people, only the registry fields. */
export function parseStaff(raw: unknown) {
  const list = raw && typeof raw === 'object' ? (raw as any).operatori : null;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  return list.slice(0, MAX_PEOPLE).flatMap((o: any) => {
    const id = typeof o?.id === 'string' || typeof o?.id === 'number' ? String(o.id).trim().slice(0, 40) : '';
    if (!id || seen.has(id)) return [];
    const p = PROPOSAL_SCHEMAS.dipendente.safeParse({
      name: String(o.nome ?? '').slice(0, 120),
      role: String(o.mansione || o.reparto || '').slice(0, 120),
      hired: typeof o.assunto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.assunto) ? o.assunto : '',
      active: true,
    });
    if (!p.success) return [];
    seen.add(id);
    return [{ id, data: p.data }];
  });
}

/** Hourly from the Worker Cron, with the holding link. Never throws. */
export async function syncStaff(env: Env, now: Date, fetchImpl: Fetch = fetch) {
  const key = (env.HOLDING_SEGNALE_KEY || '').trim();
  const target = holdingTarget(env.HOLDING_URL);
  const db = env.DB;
  if (!key || !target || !db) return { ok: false, reason: 'Collegamento non configurato' };
  try {
    const owner = (
      await db.prepare('SELECT owner FROM admin_identity WHERE slot=1').first<{ owner: string }>()
    )?.owner;
    if (!owner) return { ok: false, reason: 'Nessun titolare configurato' };
    const res = await fetchImpl(new URL('operatori', target).toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'BlindoService-holding' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status, reason: `La centrale risponde ${res.status}` };
    const people = parseStaff(await res.json().catch(() => null));
    if (!people) return { ok: false, reason: 'Personale non valido (serve Kassaro OS 8.4.0)' };
    const at = now.toISOString();
    const counts = { nuove: 0, aggiornate: 0, invariate: 0 };
    for (const p of people) {
      const data = JSON.stringify(p.data);
      const external = 'dipendente:' + p.id;
      const prev = await db
        .prepare('SELECT id,data FROM integration_inbox WHERE owner=? AND source=? AND external_key=?')
        .bind(owner, STAFF_SOURCE, external)
        .first<{ id: string; data: string }>();
      if (prev?.data === data) counts.invariate++;
      else if (prev) {
        await db
          .prepare(
            "UPDATE integration_inbox SET data=?,status='in_attesa',created=?,decided=NULL,key_id='centrale' WHERE id=?",
          )
          .bind(data, at, prev.id)
          .run();
        counts.aggiornate++;
      } else {
        await db
          .prepare(
            "INSERT INTO integration_inbox(id,owner,key_id,source,kind,external_key,data,file_id,status,created) VALUES(?,?,'centrale',?,'dipendente',?,?,NULL,'in_attesa',?)",
          )
          .bind(crypto.randomUUID(), owner, STAFF_SOURCE, external, data, at)
          .run();
        counts.nuove++;
      }
    }
    return { ok: true, persone: people.length, ...counts };
  } catch (err) {
    const network = err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError');
    return { ok: false, reason: network ? 'Centrale non raggiungibile' : 'Salvataggio non riuscito' };
  }
}
