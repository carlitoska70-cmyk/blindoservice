import { env } from 'cloudflare:workers';
import { login, ownerCredentials } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return login(
    req,
    env.DB,
    await ownerCredentials(env.DB, env.PRESIDIO_ADMIN_CREDENTIALS),
    env.PRESIDIO_STAFF_CREDENTIALS,
  );
}
