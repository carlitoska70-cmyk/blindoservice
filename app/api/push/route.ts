import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db, rate, response } from '@/lib/portal-server';
import { getOperator } from '@/lib/operator';
import { notifyPhones, phones, subscribePhone, unsubscribePhone, vapidKeys } from '@/lib/push';
export const dynamic = 'force-dynamic';

// The owner's phones for Blindo's notifications (inspector at the portal, deadlines, important news).
// Only the browsers' own push services are accepted as endpoints.
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.apple.com',
  'push.services.mozilla.com',
  'notify.windows.com',
];
const pushEndpoint = z
  .string()
  .url()
  .max(1000)
  .refine(u => {
    const h = new URL(u);
    return h.protocol === 'https:' && PUSH_HOSTS.some(d => h.hostname === d || h.hostname.endsWith('.' + d));
  });
const subscription = z.object({
  endpoint: pushEndpoint,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});

export async function GET(req: Request) {
  const user = await getOperator();
  if (!user) return response({ error: 'Accesso richiesto' }, 401);
  if (!env.DB) return response({ error: 'Archivio non disponibile' }, 503);
  const keys = await vapidKeys(env.DB, new URL(req.url).origin);
  return response({ publicKey: keys.publicKey, phones: await phones(env.DB, user.userId) });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    if (req.headers.get('origin') !== url.origin) return response({ error: 'Origine non valida' }, 403);
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    if (!env.DB) return response({ error: 'Archivio non disponibile' }, 503);
    const b: any = await req.json();
    if (b.action === 'subscribe') {
      const s = subscription.parse(b.subscription);
      await rate('push-sub:' + user.userId, 20, 3600);
      await vapidKeys(env.DB, url.origin);
      await subscribePhone(
        env.DB,
        user.userId,
        { endpoint: s.endpoint, ...s.keys },
        req.headers.get('user-agent') || '',
      );
      return response({ ok: true, phones: await phones(env.DB, user.userId) });
    }
    if (b.action === 'unsubscribe') {
      await unsubscribePhone(env.DB, user.userId, pushEndpoint.parse(b.endpoint));
      return response({ ok: true, phones: await phones(env.DB, user.userId) });
    }
    if (b.action === 'test') {
      await rate('push-test:' + user.userId, 10, 3600);
      const r = await notifyPhones(env.DB, user.userId, {
        title: 'Blindo Service',
        body: 'Gli avvisi arrivano su questo telefono: quando un controllore entra nel portale lo saprai subito.',
        url: '/',
        tag: 'blindo-prova',
      });
      return response(r);
    }
    return response({ error: 'Operazione non valida' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (e instanceof z.ZodError) return response({ error: 'Iscrizione non valida' }, 400);
    if (msg.startsWith('Troppe')) return response({ error: 'Troppe richieste: riprova più tardi.' }, 429);
    console.error('push route failed', msg || 'unknown');
    return response({ error: 'Operazione non riuscita' }, 502);
  }
}
