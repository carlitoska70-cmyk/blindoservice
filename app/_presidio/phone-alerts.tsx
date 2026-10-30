'use client';
import { useEffect, useState } from 'react';
import { BellRing, BellOff, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from './shared';

type Status = { publicKey: string; phones: number };
type Channels = { telegram: boolean; email: boolean; push: number };

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;
// iPhone: notifications work only from the app added to the Home screen (iOS 16.4 or later).
const iphoneOutsideApp = () =>
  typeof window !== 'undefined' &&
  /iPhone|iPad/.test(navigator.userAgent) &&
  !(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone);

const toBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
async function post(body: unknown) {
  const r = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || 'Operazione non riuscita');
  return d;
}

/**
 * The owner's phones: Blindo rings them when an inspector identifies at the portal, every morning for
 * the deadlines and for important news. Telegram and email remain as extra channels.
 */
export default function PhoneAlerts() {
  const [status, setStatus] = useState<Status | null>(null),
    [channels, setChannels] = useState<Channels | null>(null),
    [here, setHere] = useState(false),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [s, c] = await Promise.all([
      fetch('/api/push', { cache: 'no-store' }).then(r => (r.ok ? (r.json() as Promise<Status>) : null)),
      fetch('/api/reminders', { cache: 'no-store' }).then(r => (r.ok ? (r.json() as Promise<any>) : null)),
    ]);
    setStatus(s);
    setChannels(c?.channels || null);
    if (supported()) {
      const reg = await navigator.serviceWorker.getRegistration();
      setHere(!!(await reg?.pushManager.getSubscription()));
    }
  };
  useEffect(() => {
    load().catch(() => {});
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const enable = () =>
    act(async () => {
      if (!status) throw new Error('Riprova tra un attimo');
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error('Notifiche non permesse: abilitale nelle impostazioni del telefono per questo sito.');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBytes(status.publicKey),
        }));
      await post({ action: 'subscribe', subscription: sub.toJSON() });
      toast.success('Avvisi attivi su questo telefono');
    });
  const disable = () =>
    act(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post({ action: 'unsubscribe', endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      toast.success('Avvisi disattivati su questo telefono');
    });
  const test = () =>
    act(async () => {
      const r = await post({ action: 'test' });
      if (!r.sent) throw new Error('Nessun telefono ha ricevuto l’avviso: riattivalo su questo telefono.');
      toast.success(`Avviso mandato a ${r.sent} ${r.sent === 1 ? 'telefono' : 'telefoni'}`);
    });
  const on = (v?: boolean) => <Badge tone={v ? 'green' : 'gray'}>{v ? 'Attivo' : 'Non configurato'}</Badge>;
  return (
    <section className="panel">
      <p className="eyebrow">AVVISI</p>
      <h2>Avvisi sul telefono</h2>
      <p className="muted">
        Blindo ti avvisa subito quando un controllore si identifica al portale QR, ogni mattina per le date da
        riesaminare (a 30, 7, 1 giorno e il giorno stesso) e per le novità importanti.
      </p>
      {!supported() ? (
        <p className="smallnote">Questo browser non riceve notifiche: usa il telefono con l’app di Blindo.</p>
      ) : iphoneOutsideApp() ? (
        <p className="smallnote">
          Su iPhone gli avvisi arrivano solo dall’app: in Safari tocca Condividi › «Aggiungi alla schermata
          Home», apri Blindo da lì e torna qui.
        </p>
      ) : (
        <div className="row aicheck-actions">
          {here ? (
            <>
              <button className="button primary" disabled={busy} onClick={test}>
                {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Manda un avviso di prova
              </button>
              <button className="button secondary" disabled={busy} onClick={disable}>
                <BellOff size={16} /> Disattiva su questo telefono
              </button>
            </>
          ) : (
            <button className="button primary" disabled={busy || !status} onClick={enable}>
              {busy ? <Loader2 size={16} className="spin" /> : <BellRing size={16} />} Attiva gli avvisi su
              questo telefono
            </button>
          )}
        </div>
      )}
      <div className="archivedrow">
        <span>Telefoni collegati</span>
        <Badge tone={status?.phones ? 'green' : 'gray'}>{status?.phones || 0}</Badge>
      </div>
      <div className="archivedrow">
        <span>Telegram</span>
        {on(channels?.telegram)}
      </div>
      <div className="archivedrow">
        <span>Email</span>
        {on(channels?.email)}
      </div>
    </section>
  );
}
