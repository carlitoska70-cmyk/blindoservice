'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';

/**
 * The merchant chooses the email for signing in; Blindo creates the key here and shows it once.
 * The token is read from the address and removed from it, so it does not stay in the history.
 */
export default function Activation() {
  const [token, setToken] = useState(''),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState<{ email: string; key: string } | null>(null),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('t') || '';
    setToken(t);
    if (t) history.replaceState(null, '', '/attiva');
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/attiva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error || 'Attivazione non riuscita');
      setDone({ email: d.email, key: d.key });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <section className="panel">
        <p className="eyebrow">BLINDO SERVICE · ATTIVATO</p>
        <h1 style={{ fontSize: 28 }}>La tua chiave d’accesso</h1>
        <p className="muted" style={{ margin: '12px 0' }}>
          Questa è la password per entrare con <strong>{done.email}</strong>. Si vede{' '}
          <strong>solo adesso</strong>: salvala nel portachiavi del telefono o in un gestore di password. Dopo
          il primo accesso aggiungi la passkey (Face ID) in Azienda, così non dovrai più digitarla.
        </p>
        <p
          className="keybox"
          style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', fontSize: 18 }}
        >
          {done.key}
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            className="button secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(done.key);
              setCopied(true);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiata' : 'Copia la chiave'}
          </button>
          <a className="button primary" href="/login">
            <KeyRound size={16} /> Vai all’accesso
          </a>
        </div>
        <p className="smallnote">
          Se la perdi, l’assistenza ti manda un nuovo link di attivazione: la vecchia chiave smette di valere.
        </p>
      </section>
    );
  return (
    <section className="panel">
      <p className="eyebrow">BLINDO SERVICE</p>
      <h1 style={{ fontSize: 28 }}>Attiva il tuo Blindo Service</h1>
      <p className="muted" style={{ margin: '12px 0' }}>
        Scrivi l’email con cui vuoi entrare. Blindo crea la tua chiave d’accesso e te la mostra una sola
        volta: nessuno, nemmeno l’assistenza, la conosce.
      </p>
      {!token ? (
        <p role="alert" className="notice error">
          Apri questa pagina dal link di attivazione che hai ricevuto.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : null} Attiva e crea la chiave
          </button>
        </form>
      )}
    </section>
  );
}
