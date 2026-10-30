// A merchant's copy made by the factory: suspended subscriptions and the hourly technical report to the
// sales portal. Carlo's own copy has neither (no BLINDO_SOSPESO, no PORTALE_URL).
// Self-contained (no imports) so the Node tests can load it directly.

type Env = {
  DB?: D1Database;
  BLINDO_SOSPESO?: string;
  BLINDO_COPIA?: string;
  PORTALE_URL?: string;
  PORTALE_CHIAVE?: string;
  AI_TETTO_EURO?: string;
  PRESIDIO_ADMIN_CREDENTIALS?: string;
};

/** While suspended these still work: signing in and out, the inspectors' portal, notifications. */
const ALLOWED_WHILE_SUSPENDED = ['/api/auth/', '/api/portal', '/api/push'];

export const suspended = (env: Env) => env.BLINDO_SOSPESO === '1';

/**
 * Suspended subscription: the archive is read-only. Reading, the QR portal for inspectors and alerts keep
 * working, so a merchant is never left exposed during an inspection; changes and AI stop.
 */
export function suspensionBlock(req: Request, env: Env) {
  if (!suspended(env)) return null;
  const { pathname } = new URL(req.url);
  if (req.method === 'GET' || req.method === 'HEAD' || !pathname.startsWith('/api/')) return null;
  if (ALLOWED_WHILE_SUSPENDED.some(p => pathname.startsWith(p))) return null;
  return Response.json(
    {
      error:
        'Abbonamento sospeso: l’archivio è in sola lettura. Il portale QR per i controllori funziona. Per riattivare contatta l’assistenza.',
      sospeso: true,
    },
    { status: 402, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Only HTTPS, or plain HTTP on loopback for local tests. */
function target(url?: string) {
  try {
    const u = new URL(url || '');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return u.protocol === 'https:' || (u.protocol === 'http:' && loopback) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Hourly technical report to the sales portal: counts and version only (no names, no titles, no content),
 * so Carlo can support the merchant, apply the AI cap and see that the copy is alive. Never throws.
 */
export async function reportToPortal(
  env: Env,
  version: string,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
) {
  const url = target(env.PORTALE_URL),
    key = (env.PORTALE_CHIAVE || '').trim();
  if (!url || !key || !env.DB) return { sent: false, reason: 'Portale non configurato' };
  const db = env.DB;
  try {
    const one = async (sql: string, ...bind: unknown[]) =>
      (
        await db
          .prepare(sql)
          .bind(...bind)
          .first<{ n: number }>()
      )?.n || 0;
    const month = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 7);
    const spent = await db.prepare('SELECT euro, calls FROM ai_usage WHERE month=?').bind(month).first<any>();
    const cap = Number(env.AI_TETTO_EURO);
    const body = {
      copia: env.BLINDO_COPIA || '',
      versione: version,
      generato: now.toISOString(),
      attivata: !!(
        env.PRESIDIO_ADMIN_CREDENTIALS || (await one('SELECT COUNT(*) AS n FROM admin_credentials'))
      ),
      sospesa: suspended(env),
      telefoni: await one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE active=1'),
      documenti: await one(
        "SELECT COUNT(*) AS n FROM records WHERE kind='document' AND json_extract(data,'$.archivedAt') IS NULL",
      ),
      portale_attivo: (await one('SELECT COUNT(*) AS n FROM portals WHERE enabled=1')) > 0,
      ia: {
        mese: month,
        euro: Math.round((spent?.euro || 0) * 100) / 100,
        chiamate: spent?.calls || 0,
        tetto: cap > 0 ? cap : null,
      },
    };
    const r = await fetchImpl(new URL('api/copie/segnale', url).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { sent: r.ok, status: r.status };
  } catch (e) {
    return {
      sent: false,
      reason:
        e instanceof Error && e.name === 'TimeoutError'
          ? 'Il portale non risponde'
          : 'Portale non raggiungibile',
    };
  }
}
