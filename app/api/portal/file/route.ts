import { env } from 'cloudflare:workers';
import { db, event, failure, rate, response, visitor } from '@/lib/portal-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const v = await visitor(req);
    if (v?.status !== 'autorizzata') return response({ error: 'Sessione non autorizzata' }, 403);
    await rate('file:' + v.id, 120, 60);
    const id = new URL(req.url).searchParams.get('document');
    const f = await db()
      .prepare(
        'SELECT f.*,g.version,g.title FROM grants g JOIN files f ON f.id=g.file_id AND f.owner=g.owner WHERE g.visit_id=? AND g.document_id=? AND g.owner=?',
      )
      .bind(v.id, id, v.owner)
      .first<any>();
    if (!f || !env.BUCKET) return response({ error: 'Documento non disponibile' }, 404);
    const object = await env.BUCKET.get(f.object_key);
    if (!object) return response({ error: 'Allegato non disponibile' }, 404);
    await event(v, 'file_erogato', { documentId: id, title: f.title, version: f.version, sha256: f.sha256 });
    return new Response(object.body, {
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
