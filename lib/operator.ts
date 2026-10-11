import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, readSession } from './admin-auth';

/** Any signed-in account: the owner or the collaborator (check `role`). */
export async function getMember() {
  const token = (await cookies()).get(COOKIE)?.value || '';
  if (!token) return null;
  try {
    return await readSession(env.DB, env.PRESIDIO_ADMIN_CREDENTIALS, token, env.PRESIDIO_STAFF_CREDENTIALS);
  } catch {
    return null;
  }
}
/** Owner only. Routes use this unless they explicitly allow the collaborator. */
export async function getOperator() {
  const user = await getMember();
  return user?.role === 'owner' ? user : null;
}
export async function requireMember() {
  const user = await getMember();
  if (!user) redirect('/login');
  return user;
}
export async function requireOperator() {
  const user = await getMember();
  if (!user) redirect('/login');
  // A signed-in collaborator goes back to the archive instead of the login page.
  if (user.role !== 'owner') redirect('/');
  return user;
}
