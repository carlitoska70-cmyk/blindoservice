import { env } from 'cloudflare:workers';
import {
  config,
  cookie,
  limitedBody,
  ownerId,
  rateLimited,
  sameOrigin,
  startSession,
  ownerCredentials,
} from '@/lib/admin-auth';
import { getOperator } from '@/lib/operator';
import { b64url, issueChallenge, registerPasskey, verifyPasskey } from '@/lib/passkey';
export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', ...extra },
  });

/** Owner's registered passkeys (no key material). */
export async function GET() {
  const user = await getOperator();
  if (!user) return json({ error: 'Accesso richiesto' }, 401);
  if (!env.DB) return json({ error: 'Archivio non disponibile' }, 503);
  const rows = await env.DB.prepare(
    'SELECT id,label,created,last_used FROM admin_passkeys WHERE owner=? ORDER BY created',
  )
    .bind(user.userId)
    .all();
  return json({ passkeys: rows.results });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non valida' }, 403);
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    return json({ error: 'Formato non valido' }, 415);
  const db = env.DB;
  if (!db) return json({ error: 'Archivio non disponibile' }, 503);
  const url = new URL(req.url),
    rpId = url.hostname,
    origin = url.origin;
  try {
    const b = JSON.parse(await limitedBody(req));
    if (b.action === 'login-options' || b.action === 'login') {
      if (await rateLimited(req, db)) return json({ error: 'Troppi tentativi. Attendi 15 minuti.' }, 429);
      if (b.action === 'login-options')
        return json({ challenge: await issueChallenge(db, 'login'), rpId, userVerification: 'required' });
      const c = config(await ownerCredentials(db, env.PRESIDIO_ADMIN_CREDENTIALS));
      const owner = await verifyPasskey(db, b.credential, origin, rpId);
      if (owner !== (await ownerId(db))) throw new Error('PASSKEY_OWNER');
      const token = await startSession(req, db, c, owner);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(token) });
    }
    // Everything else manages passkeys and needs an owner session.
    const user = await getOperator();
    if (!user) return json({ error: 'Accesso richiesto' }, 401);
    if (b.action === 'register-options') {
      const existing = await db
        .prepare('SELECT id FROM admin_passkeys WHERE owner=?')
        .bind(user.userId)
        .all<{ id: string }>();
      return json({
        challenge: await issueChallenge(db, 'register'),
        rp: { id: rpId, name: 'Blindo Service' },
        user: {
          id: b64url.encode(new TextEncoder().encode(user.userId).slice(0, 64)),
          name: user.email,
          displayName: user.email,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: 120000,
        excludeCredentials: existing.results.map(x => ({ type: 'public-key', id: x.id })),
      });
    }
    if (b.action === 'register') {
      const saved = await registerPasskey(db, user.userId, b.credential, origin, rpId);
      return json({ ok: true, passkey: saved });
    }
    if (b.action === 'delete') {
      const id = typeof b.id === 'string' ? b.id.slice(0, 1400) : '';
      await db.prepare('DELETE FROM admin_passkeys WHERE id=? AND owner=?').bind(id, user.userId).run();
      return json({ ok: true });
    }
    return json({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    if (code === 'BODY') return json({ error: 'Richiesta troppo grande' }, 413);
    if (code.startsWith('PASSKEY') || e instanceof SyntaxError || e instanceof TypeError)
      return json({ error: 'Passkey non valida o scaduta. Riprova.' }, 400);
    if (code === 'AUTH_CONFIG') return json({ error: 'Accesso non configurato' }, 503);
    console.error('passkey failed', code || 'unknown');
    return json({ error: 'Operazione non riuscita. Riprova.' }, 503);
  }
}
