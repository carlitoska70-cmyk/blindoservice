import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, readSession } from './admin-auth';
export async function getOperator() {
  const token = (await cookies()).get(COOKIE)?.value || '';
  if (!token) return null;
  try {
    return await readSession(env.DB, env.PRESIDIO_ADMIN_CREDENTIALS, token);
  } catch {
    return null;
  }
}
export async function requireOperator() {
  const user = await getOperator();
  if (!user) redirect('/login');
  return user;
}
