'use client';
import './print.css';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import type { Entry, Profile } from '@/lib/product';
import { api, fmt, time } from '../_presidio/shared';

type State = { profile: Profile; records: Entry[] } | null;

const stamp = (s: string) => (s ? fmt(s) + ' ' + time(s) : 'Non indicato');

// Print layout of an inspection file. "Salva come PDF" in the print dialog produces the PDF.
export default function FascicoloPrint({ id }: { id: string }) {
  const [state, setState] = useState<State>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api()
      .then(setState)
      .catch(e => setError((e as Error).message));
  }, []);
  if (error) return <main className="print-page">{error}</main>;
  if (!state) return <main className="print-page">Preparazione del fascicolo…</main>;
  const inspection = state.records.find(x => x.id === id && x.kind === 'inspection');
  if (!inspection) return <main className="print-page">Fascicolo non trovato.</main>;
  const d = inspection.data;
  const events = state.records
    .filter(x => x.kind === 'event' && x.data.inspectionId === id)
    .sort((a, b) => a.created.localeCompare(b.created));
  const reviews = state.records.filter(x => x.kind === 'review' && x.data.inspectionId === id);
  const p = state.profile;
  return (
    <main className="print-page">
      <div className="print-actions">
        <button className="button primary" onClick={() => window.print()}>
          <Printer size={16} /> Stampa o salva PDF
        </button>
        <span>Nel dialogo di stampa scegli “Salva come PDF”.</span>
      </div>
      <header className="print-head">
        <p className="eyebrow">PRESIDIO · FASCICOLO DEL CONTROLLO</p>
        <h1>{d.authority}</h1>
        <p>{d.scope}</p>
      </header>
      <section>
        <h2>Impresa</h2>
        <dl>
          <dt>Nome</dt>
          <dd>{p.name}</dd>
          <dt>Ragione sociale</dt>
          <dd>{p.legalName || 'Non indicata'}</dd>
          <dt>Partita IVA</dt>
          <dd>{p.vat || 'Non indicata'}</dd>
          <dt>Sede</dt>
          <dd>{[p.address, p.city, p.region].filter(Boolean).join(', ') || 'Non indicata'}</dd>
        </dl>
      </section>
      <section>
        <h2>Dati del controllo</h2>
        <dl>
          <dt>Ente / ufficio</dt>
          <dd>{d.authority}</dd>
          <dt>Oggetto dichiarato</dt>
          <dd>{d.scope}</dd>
          <dt>Interlocutori dichiarati</dt>
          <dd>{d.officers || 'Non annotati'}</dd>
          <dt>Riferimento</dt>
          <dd>{d.reference || 'Non indicato'}</dd>
          <dt>Inizio</dt>
          <dd>{stamp(d.started)}</dd>
          <dt>Fine</dt>
          <dd>{d.ended ? stamp(d.ended) : 'Non annotata'}</dd>
          <dt>Stato</dt>
          <dd>{d.status}</dd>
          <dt>Esito annotato</dt>
          <dd>{d.outcome || 'Non annotato'}</dd>
        </dl>
      </section>
      <section>
        <h2>Cronologia ({events.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Ora</th>
              <th>Interlocutore</th>
              <th>Tipo</th>
              <th>Annotazione</th>
            </tr>
          </thead>
          <tbody>
            {events.map(x => (
              <tr key={x.id}>
                <td>{time(x.created)}</td>
                <td>{x.data.speaker || '—'}</td>
                <td>{x.data.tag}</td>
                <td>
                  {x.data.text}
                  {x.data.fileName && <small>Allegato riservato: {x.data.fileName}</small>}
                </td>
              </tr>
            ))}
            {!events.length && (
              <tr>
                <td colSpan={4}>Nessuna annotazione.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {reviews.length > 0 && (
        <section>
          <h2>Bozze di riesame</h2>
          {reviews.map(x => (
            <article key={x.id} className="print-review">
              <small>{stamp(x.created)} · bozza generata, da verificare con il professionista</small>
              <p>{x.data.summary}</p>
              {(x.data.passages || []).map((q: any, i: number) => (
                <blockquote key={i}>
                  «{q.quote}»<small>Da verificare: {q.verification}</small>
                </blockquote>
              ))}
              {(x.data.actions || []).length > 0 && (
                <ul>
                  {x.data.actions.map((a: string, i: number) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      )}
      <footer className="print-foot">
        Documento generato il {stamp(new Date().toISOString())} dall’archivio Presidio. Raccoglie annotazioni
        dell’utente: non è un verbale dell’autorità, una perizia né un accertamento di responsabilità. Gli
        allegati originali si scaricano separatamente dall’archivio.
      </footer>
    </main>
  );
}
