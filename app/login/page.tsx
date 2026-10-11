import { redirect } from 'next/navigation';
import { getMember } from '@/lib/operator';
import PasskeyButton from './passkey-button';
export const dynamic = 'force-dynamic';
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getMember()) redirect('/');
  const { error } = await searchParams;
  return (
    <main className="visitor" style={{ maxWidth: 520, margin: '60px auto', padding: 20 }}>
      <section className="panel">
        <p className="eyebrow">BLINDOSERVICE · PRESIDIO</p>
        <h1 style={{ fontSize: 30 }}>Accesso del responsabile</h1>
        <p className="muted" style={{ margin: '16px 0' }}>
          Inserisci la tua email e la password generata durante la configurazione.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error === 'credentials'
              ? 'Email o password non corrette. Riprova.'
              : 'Accesso non configurato o archivio non disponibile. Verifica la configurazione prima di riprovare.'}
          </p>
        )}
        <form method="post" action="/api/auth/login">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" autoComplete="username" maxLength={254} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" maxLength={128} required />
          </label>
          <button className="button primary full" type="submit">
            Entra nell’archivio
          </button>
        </form>
        <PasskeyButton />
        <p className="smallnote">
          Sessione di 8 ore. Usa “Esci” quando hai finito, soprattutto sui dispositivi condivisi.
        </p>
        <a href="/accesso" className="textbutton" style={{ marginTop: 20 }}>
          Accesso visitatori tramite QR
        </a>
      </section>
    </main>
  );
}
