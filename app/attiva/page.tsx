import Activation from './activation';
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Attiva Blindo Service', referrer: 'no-referrer' };

/** Landing page of the one-time activation link sent by the factory (?t=…). */
export default function Attiva() {
  return (
    <main className="visitor" style={{ maxWidth: 560, margin: '60px auto', padding: 20 }}>
      <Activation />
    </main>
  );
}
