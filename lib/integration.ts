// Holding interchange: other software of the holding (e.g. Gionti Suite) read from
// Blindo Service and send proposals with a per-software Bearer key. Proposals never
// change the registry until the owner accepts them.
import { z } from 'zod';
import { db, digest, rate } from './portal-server';

export const SCOPES = {
  'documenti:leggi': 'Leggere l’elenco dei documenti e le scadenze',
  'file:leggi': 'Scaricare gli originali dei documenti',
  'dipendenti:leggi': 'Leggere i dipendenti e i documenti che mancano',
  'proposte:scrivi': 'Proporre documenti e dati da confermare',
} as const;
export type Scope = keyof typeof SCOPES;

const s = (max: number) => z.string().trim().max(max);
const date = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default('');
/** What a program can propose. The same normalisation decides whether a resend is unchanged. */
export const PROPOSAL_SCHEMAS = {
  dipendente: z.object({
    name: s(120).min(1),
    role: s(120).default(''),
    hired: date,
    contract: s(60).default(''),
    endDate: date,
    active: z.boolean().default(true),
  }),
  documento: z.object({
    title: s(200).min(1),
    category: s(80).default('Altro'),
    documentType: s(200).default(''),
    issued: date,
    expires: date,
    holder: s(200).default(''),
    employeeExternalId: s(100).optional(),
    notes: s(2000).default(''),
  }),
};

export const newKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    'blk_' +
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
  );
};

export class IntegrationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Validates the Bearer key and the required scope; returns the key row. */
export async function authorize(req: Request, scope: Scope) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^blk_[A-Za-z0-9_-]{43}$/.test(token)) throw new IntegrationError('Chiave mancante o non valida', 401);
  const row = await db()
    .prepare('SELECT id,owner,name,scopes FROM integration_keys WHERE key_hash=? AND revoked IS NULL')
    .bind(await digest(token))
    .first<{ id: string; owner: string; name: string; scopes: string }>();
  if (!row) throw new IntegrationError('Chiave mancante o non valida', 401);
  if (!JSON.parse(row.scopes).includes(scope))
    throw new IntegrationError('Permesso non concesso: ' + scope, 403);
  await rate('integration:' + row.id, 600, 3600);
  await db()
    .prepare('UPDATE integration_keys SET last_used=? WHERE id=?')
    .bind(new Date().toISOString(), row.id)
    .run();
  return row;
}

export function integrationFailure(e: unknown) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (e instanceof IntegrationError)
    return Response.json({ error: e.message }, { status: e.status, headers });
  const msg = e instanceof Error ? e.message : '';
  if (msg.startsWith('Troppe')) return Response.json({ error: msg }, { status: 429, headers });
  console.error('integration failed', msg || 'unknown');
  return Response.json({ error: 'Richiesta non riuscita' }, { status: 400, headers });
}

/** Public, safe view of a document for other software (no internal notes). */
export function documentView(r: { id: string; data: string; updated: string }) {
  const d = JSON.parse(r.data);
  return {
    id: r.id,
    title: d.title,
    category: d.category,
    documentType: d.documentType || '',
    issued: d.issued || '',
    expires: d.expires || '',
    holder: d.holder || '',
    employeeId: d.employeeId || null,
    hasFile: !!d.fileId,
    reviewed: !!d.reviewed,
    archived: !!d.archivedAt,
    updated: r.updated,
  };
}
