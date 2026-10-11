import { env } from 'cloudflare:workers';
import InspectorPortal from '@/app/inspector-portal';
export const dynamic = 'force-dynamic';
export default async function Access() {
  const p = await env.DB?.prepare('SELECT id FROM portals WHERE enabled=1 LIMIT 1').first<{ id: string }>();
  if (!p)
    return (
      <main className="visitor">
        <section className="panel">
          <h1>Archivio per il controllo</h1>
          <p>Il portale non è attivo. Rivolgersi al responsabile per l’esibizione dei documenti.</p>
        </section>
      </main>
    );
  return <InspectorPortal portal={p.id} />;
}
