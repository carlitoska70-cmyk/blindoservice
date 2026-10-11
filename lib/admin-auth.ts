// Passwords are generated 256-bit random keys, never human-chosen passwords.
// Incoming identity headers are never trusted.
export const COOKIE = '__Host-presidio_admin';
export const SESSION_SECONDS = 8 * 60 * 60;
type Row = Record<string, unknown>;
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
}
export type Config = { email: string; keyHash: string };
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export function randomKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export function config(raw: unknown): Config {
  if (typeof raw !== 'string') throw new Error('AUTH_CONFIG');
  let value: Config;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AUTH_CONFIG');
  }
  if (
    !value ||
    typeof value.email !== 'string' ||
    value.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    typeof value.keyHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.keyHash)
  )
    throw new Error('AUTH_CONFIG');
  return { email: value.email.trim().toLowerCase(), keyHash: value.keyHash };
}
function equal(a: string, b: string) {
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return different === 0;
}
async function fingerprint(c: Config) {
  return digest(JSON.stringify(c));
}
export function now() {
  return Math.floor(Date.now() / 1000);
}
export function cookie(token: string, clear = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}`;
}
export function cookieToken(req: Request) {
  const matches = (req.headers.get('cookie') || '')
    .split(';')
    .map(x => x.trim())
    .filter(x => x.startsWith(COOKIE + '='));
  return matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : '';
}
function reply(message: string, status: number, extra: Record<string, string> = {}) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}
function redirect(path: string, setCookie?: string) {
  return reply('', 303, { Location: path, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) });
}
// Plain HTTP is accepted only on loopback, for the local development server.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
export function sameOrigin(req: Request) {
  const url = new URL(req.url);
  return (
    req.method === 'POST' &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) &&
    req.headers.get('origin') === url.origin &&
    req.headers.get('sec-fetch-site') !== 'cross-site'
  );
}
export async function limitedBody(req: Request) {
  const max = 4096;
  if (Number(req.headers.get('content-length') || 0) > max) throw new Error('BODY');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw new Error('BODY');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}
async function limit(db: Database, key: string, max: number) {
  const time = now(),
    bucket = Math.floor(time / 900);
  const id = await digest(key + ':' + bucket);
  const row = await db
    .prepare(
      'INSERT INTO admin_login_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',
    )
    .bind(id, (bucket + 1) * 900)
    .first<{ count: number }>();
  return !!row && row.count <= max;
}
export async function ownerId(db: Database) {
  const identity = await db
    .prepare('SELECT owner FROM admin_identity WHERE slot=1')
    .first<{ owner: string }>();
  if (identity) return identity.owner;
  // Preserve the single-owner archive; never guess between multiple owners.

  const owners = new Set<string>();
  for (const table of ['profiles', 'records', 'files', 'portals', 'visits', 'portal_events']) {
    const part = await db
      .prepare('SELECT DISTINCT owner FROM ' + table + ' LIMIT 2')
      .all<{ owner: string }>();
    for (const row of part.results) owners.add(row.owner);
    if (owners.size > 1) throw new Error('MULTIPLE_OWNERS');
  }
  const rows = { results: [...owners].map(owner => ({ owner })) };
  if (rows.results.length > 1) throw new Error('MULTIPLE_OWNERS');
  const owner = rows.results[0]?.owner || 'admin:' + crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO admin_identity(slot,owner) VALUES(1,?)').bind(owner).run();
  const saved = await db.prepare('SELECT owner FROM admin_identity WHERE slot=1').first<{ owner: string }>();
  if (!saved) throw new Error('AUTH_STORAGE');
  return saved.owner;
}
export async function readSession(db: Database | undefined, rawConfig: unknown, token: string) {
  if (!db || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const c = config(rawConfig);
  const row = await db
    .prepare('SELECT owner FROM admin_sessions WHERE token_hash=? AND expires>? AND credential_hash=?')
    .bind(await digest(token), now(), await fingerprint(c))
    .first<{ owner: string }>();
  return row ? { userId: row.owner, email: c.email, displayName: c.email, fullName: null } : null;
}
/** Shared by password and passkey login: global and per-IP attempt limits (15 min window). */
export async function rateLimited(req: Request, db: Database) {
  await db.prepare('DELETE FROM admin_login_limits WHERE expires<=?').bind(now()).run();
  return (
    !(await limit(db, 'global', 60)) ||
    !(await limit(db, 'ip:' + (req.headers.get('cf-connecting-ip') || 'unknown'), 10))
  );
}
/** Creates a session bound to the current credential configuration; returns the cookie token. */
export async function startSession(req: Request, db: Database, c: Config, owner: string) {
  const token = randomKey(),
    old = cookieToken(req);
  if (/^[A-Za-z0-9_-]{43}$/.test(old))
    await db
      .prepare('DELETE FROM admin_sessions WHERE token_hash=?')
      .bind(await digest(old))
      .run();
  await db
    .prepare('INSERT INTO admin_sessions(token_hash,owner,expires,credential_hash) VALUES(?,?,?,?)')
    .bind(await digest(token), owner, now() + SESSION_SECONDS, await fingerprint(c))
    .run();
  await db.prepare('DELETE FROM admin_sessions WHERE expires<=?').bind(now()).run();
  await db.prepare('DELETE FROM admin_login_limits WHERE expires<=?').bind(now()).run();
  return token;
}
export async function login(req: Request, db: Database | undefined, rawConfig: unknown) {
  if (!sameOrigin(req)) return reply('Origine non valida. Torna alla pagina di accesso HTTPS.', 403);
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded')
    return reply('Formato non valido.', 415);
  try {
    const c = config(rawConfig);
    if (!db) throw new Error('AUTH_STORAGE');
    if (await rateLimited(req, db))
      return reply('Troppi tentativi. Attendi 15 minuti, poi torna alla pagina di accesso.', 429, {
        'Retry-After': '900',
      });
    const data = new URLSearchParams(await limitedBody(req));
    const email = (data.get('email') || '').trim().toLowerCase(),
      password = data.get('password') || '';
    const matches = equal(await digest(password), c.keyHash);
    if (
      data.getAll('email').length !== 1 ||
      data.getAll('password').length !== 1 ||
      email !== c.email ||
      !/^[A-Za-z0-9_-]{43}$/.test(password) ||
      !matches
    )
      return redirect('/login?error=credentials');
    const token = await startSession(req, db, c, await ownerId(db));
    return redirect('/', cookie(token));
  } catch (error) {
    if (error instanceof Error && error.message === 'BODY') return reply('Richiesta troppo grande.', 413);
    return redirect('/login?error=configuration');
  }
}
export async function logout(req: Request, db: Database | undefined) {
  if (!sameOrigin(req)) return reply('Origine non valida.', 403);
  try {
    if (!db) throw new Error('AUTH_STORAGE');
    const token = cookieToken(req);
    if (/^[A-Za-z0-9_-]{43}$/.test(token))
      await db
        .prepare('DELETE FROM admin_sessions WHERE token_hash=?')
        .bind(await digest(token))
        .run();
    return redirect('/login', cookie('', true));
  } catch {
    return reply('Uscita non completata. Riprova.', 503);
  }
}
