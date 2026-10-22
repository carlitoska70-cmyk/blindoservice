import { db } from '@/lib/portal-server';
import { authorize, integrationFailure } from '@/lib/integration';
export const dynamic = 'force-dynamic';

/** Health and counters for the holding (any valid key with documenti:leggi). */
export async function GET(req: Request) {
  try {
    const key = await authorize(req, 'documenti:leggi');
    const counts = await db()
      .prepare(
        "SELECT kind, count(*) AS n FROM records WHERE owner=? AND kind IN ('document','employee','inspection') AND json_extract(data,'$.archivedAt') IS NULL GROUP BY kind",
      )
      .bind(key.owner)
      .all<{ kind: string; n: number }>();
    const inbox = await db()
      .prepare("SELECT count(*) AS n FROM integration_inbox WHERE owner=? AND status='in_attesa'")
      .bind(key.owner)
      .first<{ n: number }>();
    return Response.json(
      {
        software: 'blindo-service',
        ok: true,
        chiave: key.name,
        conteggi: Object.fromEntries(counts.results.map(r => [r.kind, r.n])),
        proposteInAttesa: inbox?.n || 0,
        ora: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return integrationFailure(e);
  }
}
