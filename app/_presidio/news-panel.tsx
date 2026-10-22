'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Newspaper, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, fmt } from './shared';

type News = {
  id: string;
  created: string;
  data: {
    titolo: string;
    fonte: string;
    url: string;
    data: string;
    sintesi: string;
    perche: string;
    azioni: string[];
    scadenza: string;
    rilevanza: 'alta' | 'media' | 'bassa';
    stato: 'nuova' | 'letta' | 'archiviata';
  };
};
const TONE = { alta: 'red', media: 'amber', bassa: 'gray' } as const;

/** News from FIPE, Confcommercio, Confesercenti/FIEPET and official sources, with what to do. */
export default function NewsPanel({
  canRefresh,
  onTask,
}: {
  canRefresh: boolean;
  onTask: (title: string, notes: string) => void;
}) {
  const [items, setItems] = useState<News[] | null>(null),
    [busy, setBusy] = useState(false),
    [showRead, setShowRead] = useState(false);
  const load = () =>
    fetch('/api/novita', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then((d: any) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);
  async function post(body: unknown) {
    const r = await fetch('/api/novita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d: any = await r.json();
    if (!r.ok) throw new Error(d.error || 'Operazione non riuscita');
    return d;
  }
  if (!items) return null;
  const visible = items.filter(n => (showRead ? n.data.stato !== 'archiviata' : n.data.stato === 'nuova'));
  return (
    <section className="panel newspanel">
      <div className="sectionhead">
        <div>
          <p className="eyebrow">OSSERVATORIO</p>
          <h2>Novità da associazioni ed enti</h2>
          <p className="muted">
            FIPE, Confcommercio, Confesercenti e FIEPET, Comune di Palermo, Regione, Gazzetta Ufficiale, INPS,
            INAIL e Garante. Controllo automatico ogni lunedì; ogni notizia ha il link alla fonte.
          </p>
        </div>
        {canRefresh && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await post({ action: 'aggiorna' });
                toast.success(r.nuove ? `${r.nuove} novità trovate` : 'Nessuna novità nuova');
                await load();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Cerca novità ora
          </button>
        )}
      </div>
      {visible.map(n => (
        <article key={n.id} className={'newsitem' + (n.data.stato === 'nuova' ? ' unread' : '')}>
          <div className="sectionhead">
            <span className="row">
              <Badge tone={TONE[n.data.rilevanza]}>{n.data.rilevanza}</Badge>
              <small className="muted">
                {n.data.fonte}
                {n.data.data ? ' · ' + fmt(n.data.data) : ''}
              </small>
            </span>
            {n.data.scadenza && <Badge tone="amber">Scadenza {fmt(n.data.scadenza)}</Badge>}
          </div>
          <h3>
            <a href={n.data.url} target="_blank" rel="noreferrer">
              {n.data.titolo} <ArrowUpRight size={14} />
            </a>
          </h3>
          <p>{n.data.sintesi}</p>
          {n.data.perche && (
            <p className="newswhy">
              <strong>Perché ti riguarda:</strong> {n.data.perche}
            </p>
          )}
          {n.data.azioni.length > 0 && (
            <ul>
              {n.data.azioni.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          {canRefresh && (
            <div className="row">
              <button
                className="textbutton"
                onClick={() =>
                  onTask(
                    ('Novità: ' + n.data.titolo).slice(0, 200),
                    [n.data.sintesi, ...n.data.azioni, 'Fonte: ' + n.data.url].join('\n'),
                  )
                }
              >
                <Plus size={14} /> Crea azione
              </button>
              {n.data.stato === 'nuova' ? (
                <button
                  className="textbutton"
                  onClick={() => post({ action: 'stato', id: n.id, stato: 'letta' }).then(load)}
                >
                  Segna come letta
                </button>
              ) : (
                <button
                  className="textbutton"
                  onClick={() => post({ action: 'stato', id: n.id, stato: 'archiviata' }).then(load)}
                >
                  Archivia
                </button>
              )}
            </div>
          )}
        </article>
      ))}
      {!visible.length && (
        <div className="empty">
          <Newspaper />
          <p>
            {items.length
              ? 'Nessuna novità da leggere.'
              : 'Ancora nessuna ricerca: premi «Cerca novità ora».'}
          </p>
        </div>
      )}
      {items.some(n => n.data.stato !== 'nuova') && (
        <button className="textbutton" onClick={() => setShowRead(v => !v)}>
          {showRead ? 'Mostra solo le nuove' : 'Mostra anche le lette'}
        </button>
      )}
      <p className="smallnote">
        Sintesi generate con l’IA dalle pagine delle fonti: prima di agire leggi la fonte e, se serve, chiedi
        al tuo consulente o all’associazione.
      </p>
    </section>
  );
}
