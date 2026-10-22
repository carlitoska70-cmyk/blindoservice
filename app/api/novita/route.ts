import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db, rate, response } from '@/lib/portal-server';
import { getMember, getOperator } from '@/lib/operator';
import { searchNews } from '@/lib/news-job';
export const dynamic = 'force-dynamic';

// The weekly search runs from the Worker Cron (lib/news-job.ts); here only the owner's
// «Cerca novità ora» and the read/archive state of each item.

export async function GET() {
  const user = await getMember();
  if (!user) return response({ error: 'Accesso richiesto' }, 401);
  const rows = await db()
    .prepare(
      "SELECT id,data,created,updated FROM records WHERE owner=? AND kind='news' ORDER BY created DESC LIMIT 100",
    )
    .bind(user.userId)
    .all<any>();
  return response({ items: rows.results.map(r => ({ ...r, data: JSON.parse(r.data) })) });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    if (req.headers.get('origin') !== url.origin) return response({ error: 'Origine non valida' }, 403);
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    const b: any = await req.json();
    if (b.action === 'aggiorna') {
      if (!env.OPENAI_API_KEY) return response({ error: 'Servizio IA non collegato' }, 503);
      await rate('news:' + user.userId, 4, 3600);
      return response(await searchNews(env, user.userId, new Date(), url.origin));
    }
    if (b.action === 'stato') {
      const id = z.string().max(100).parse(b.id);
      const stato = z.enum(['nuova', 'letta', 'archiviata']).parse(b.stato);
      await db()
        .prepare(
          "UPDATE records SET data=json_set(data,'$.stato',?),updated=? WHERE id=? AND owner=? AND kind='news'",
        )
        .bind(stato, new Date().toISOString(), id, user.userId)
        .run();
      return response({ ok: true });
    }
    return response({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('Troppe'))
      return response({ error: 'Hai già aggiornato da poco: riprova tra un’ora.' }, 429);
    if (e instanceof z.ZodError) return response({ error: 'Dati non validi' }, 400);
    console.error('news failed', msg || 'unknown');
    return response({ error: 'Ricerca delle novità non riuscita. Riprova più tardi.' }, 502);
  }
}
