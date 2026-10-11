import { env } from 'cloudflare:workers';
import { login } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) { return login(req, env.DB, (env as unknown as Record<string, unknown>).PRESIDIO_ADMIN_CREDENTIALS); }
