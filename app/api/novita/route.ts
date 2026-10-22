import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db, rate, response } from '@/lib/portal-server';
import { getMember, getOperator } from '@/lib/operator';
import { responsesJson } from '@/lib/openai';
import { NEWS_INSTRUCTIONS, NEWS_MODEL, newsKey, parseNews } from '@/lib/news';
import { send, type NotifyEnv } from '@/lib/notify';
export const dynamic = 'force-dynamic';

async function sameSecret(a: string, b: string) {
  const enc = (v: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const [x, y] = await Promise.all([enc(a), enc(b)]);
  const u = new Uint8Array(x),
    v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

async function ownerIdForJob() {
  const row = await db().prepare('SELECT owner FROM admin_identity WHERE slot=1').first<{ owner: string }>();
  return row?.owner || null;
}

/** Searches the web (allowed sources only), stores new items, alerts on high relevance. */
async function refresh(uid: string, origin: string) {
  const known = await db()
    .prepare("SELECT json_extract(data,'$.key') AS k FROM records WHERE owner=? AND kind='news'")
    .bind(uid)
    .all<{ k: string }>();
  const profile = await db().prepare('SELECT data FROM profiles WHERE owner=?').bind(uid).first<any>();
  const raw = await responsesJson(
    { key: env.OPENAI_API_KEY!, base: env.OPENAI_BASE_URL },
    {
      model: NEWS_MODEL,
      instructions: NEWS_INSTRUCTIONS,
      input: JSON.stringify({
        oggi: new Date().toISOString().slice(0, 10),
        attivita: profile ? JSON.parse(profile.data).activity || 'Bar e ristorazione' : 'Bar e ristorazione',
        citta: 'Palermo',
      }),
      maxTokens: 5000,
      timeoutMs: 150000,
      webSearch: true,
    },
  );
  const { items, discarded } = parseNews(raw, new Set(known.results.map(r => r.k)));
  const now = new Date().toISOString();
  for (const n of items)
    await db()
      .prepare('INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,?,?,?,?)')
      .bind(
        crypto.randomUUID(),
        uid,
        'news',
        JSON.stringify({ ...n, key: newsKey(n.url), stato: 'nuova', model: NEWS_MODEL }),
        now,
        now,
      )
      .run();
  const important = items.filter(n => n.rilevanza === 'alta');
  if (important.length)
    await send(
      env as unknown as NotifyEnv,
      `Blindo Service: ${important.length} novità importanti`,
      [
        'NOVITÀ DA ASSOCIAZIONI ED ENTI',
        ...important.map(
          n => `• ${n.titolo} (${n.fonte})${n.scadenza ? ' — scadenza ' + n.scadenza : ''}\n  ${n.url}`,
        ),
        `Apri Blindo Service › Norme: ${origin}/`,
      ].join('\n'),
    ).catch(() => {});
  return { nuove: items.length, importanti: important.length, scartate: discarded };
}

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
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    // Weekly job (GitHub Actions) with the reminder token.
    if (bearer) {
      const expected = env.PRESIDIO_REMINDER_TOKEN || '';
      if (expected.length < 32 || !(await sameSecret(bearer, expected)))
        return response({ error: 'Non autorizzato' }, 401);
      if (!env.OPENAI_API_KEY) return response({ error: 'Servizio IA non collegato' }, 503);
      const uid = await ownerIdForJob();
      if (!uid) return response({ error: 'Nessun titolare configurato' }, 409);
      return response(await refresh(uid, url.origin));
    }
    if (req.headers.get('origin') !== url.origin) return response({ error: 'Origine non valida' }, 403);
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    const b: any = await req.json();
    if (b.action === 'aggiorna') {
      if (!env.OPENAI_API_KEY) return response({ error: 'Servizio IA non collegato' }, 503);
      await rate('news:' + user.userId, 4, 3600);
      return response(await refresh(user.userId, url.origin));
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
