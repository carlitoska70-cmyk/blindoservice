import { env } from 'cloudflare:workers';
import { db } from '@/lib/portal-server';
import { authorize, integrationFailure } from '@/lib/integration';
export const dynamic = 'force-dynamic';

/** Original file of a registered document (?documento=<id>). Audio of inspections is never served. */
export async function GET(req: Request) {
  try {
    const key = await authorize(req, 'file:leggi');
    const id = new URL(req.url).searchParams.get('documento') || '';
    const doc = await db()
      .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='document'")
      .bind(id, key.owner)
      .first<{ data: string }>();
    const fileId = doc ? JSON.parse(doc.data).fileId : null;
    const f = fileId
      ? await db()
          .prepare('SELECT name,mime,object_key,sha256 FROM files WHERE id=? AND owner=?')
          .bind(fileId, key.owner)
          .first<any>()
      : null;
    if (!f || f.mime.startsWith('audio/') || !env.BUCKET)
      return Response.json({ error: 'Documento non disponibile' }, { status: 404 });
    const object = await env.BUCKET.get(f.object_key);
    if (!object) return Response.json({ error: 'Documento non disponibile' }, { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-SHA256': f.sha256,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return integrationFailure(e);
  }
}
