import { db } from '@/lib/portal-server';
import { authorize, integrationFailure } from '@/lib/integration';
import { staffSummary } from '@/lib/staff';
import { romeToday } from '@/lib/reminders';
export const dynamic = 'force-dynamic';

/** Employees with what is missing or expiring (no document contents). */
export async function GET(req: Request) {
  try {
    const key = await authorize(req, 'dipendenti:leggi');
    const rows = await db()
      .prepare("SELECT id,kind,data FROM records WHERE owner=? AND kind IN ('employee','document')")
      .bind(key.owner)
      .all<{ id: string; kind: string; data: string }>();
    const parsed = rows.results.map(r => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data) }));
    const employees = parsed.filter(r => r.kind === 'employee');
    const docs = parsed.filter(r => r.kind === 'document');
    return Response.json(
      {
        dipendenti: staffSummary(employees, docs, romeToday()).map(s => ({
          ...s,
          externalId: employees.find(e => e.id === s.id)?.data.externalId || null,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return integrationFailure(e);
  }
}
