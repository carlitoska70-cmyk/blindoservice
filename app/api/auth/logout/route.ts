import { env } from 'cloudflare:workers';
import { logout } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return logout(req, env.DB);
}
