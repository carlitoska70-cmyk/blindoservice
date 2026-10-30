import { env } from 'cloudflare:workers';
import { activate, limitedBody, sameOrigin } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

const MESSAGES: Record<string, [string, number]> = {
  ACTIVATION_DISABLED: ['Questa copia si accede con la chiave del titolare: l’attivazione non serve.', 404],
  ACTIVATION_INVALID: [
    'Link di attivazione non valido, già usato o scaduto. Chiedine uno nuovo all’assistenza.',
    400,
  ],
  ACTIVATION_EMAIL: ['Scrivi un indirizzo email valido.', 400],
  ACTIVATION_LIMIT: ['Troppi tentativi. Attendi 15 minuti.', 429],
};

/** One-time activation of a merchant's copy: returns the owner's key, shown once on the page. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'Origine non valida' }, 403);
  try {
    const b = JSON.parse(await limitedBody(req));
    const r = await activate(
      req,
      env.DB,
      env.PRESIDIO_ADMIN_CREDENTIALS,
      String(b.token || ''),
      String(b.email || ''),
    );
    return json({ ok: true, email: r.email, key: r.key });
  } catch (e) {
    const [msg, status] = MESSAGES[e instanceof Error ? e.message : ''] || [
      'Attivazione non riuscita. Riprova.',
      400,
    ];
    return json({ error: msg }, status);
  }
}
