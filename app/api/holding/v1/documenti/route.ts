import { db } from '@/lib/portal-server';
import { authorize, documentView, integrationFailure } from '@/lib/integration';
export const dynamic = 'force-dynamic';

/** Document list with expiries. ?since=ISO for changes only, ?dipendente=<id> for one employee. */
export async function GET(req: Request) {
  try {
    const key = await authorize(req, 'documenti:leggi');
    const url = new URL(req.url);
    const since = url.searchParams.get('since') || '';
    if (since && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since))
      return Response.json({ error: 'Parametro since non valido' }, { status: 400 });
    const employee = url.searchParams.get('dipendente') || '';
    const rows = await db()
      .prepare(
        "SELECT id,data,updated FROM records WHERE owner=? AND kind='document'" +
          (since ? ' AND updated>=?' : '') +
          (employee ? " AND json_extract(data,'$.employeeId')=?" : '') +
          ' ORDER BY updated',
      )
      .bind(key.owner, ...(since ? [since] : []), ...(employee ? [employee] : []))
      .all<{ id: string; data: string; updated: string }>();
    const documenti = rows.results.map(documentView);
    const cursor = documenti.reduce((m, d) => (d.updated > m ? d.updated : m), since);
    return Response.json({ documenti, cursor }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return integrationFailure(e);
  }
}
