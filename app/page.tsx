import Presidio from './presidio';
import { requireMember } from '@/lib/operator';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireMember();
  if (!user)
    return (
      <main className="panel empty">
        <h1>Area del responsabile</h1>
        <p>Questo account non è abilitato. Per consultare i documenti usa il QR esposto nell’attività.</p>
      </main>
    );
  return <Presidio name={user.displayName} role={user.role} />;
}
