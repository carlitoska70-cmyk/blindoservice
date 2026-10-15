'use client';
import '../fascicolo/print.css';
import { useEffect, useState } from 'react';
import { FileDown, Headphones, Printer } from 'lucide-react';
import type { Entry } from '@/lib/product';
import { api, fmt, time } from '../_presidio/shared';

const stamp = (s: string) => (s ? fmt(s) + ' ' + time(s) : 'non indicato');

export default function ReportView({ id }: { id: string }) {
  const [report, setReport] = useState<Entry | null | undefined>(undefined),
    [error, setError] = useState('');
  useEffect(() => {
    api()
      .then(d => setReport(d.records.find((x: Entry) => x.id === id && x.kind === 'report') || null))
      .catch(e => setError((e as Error).message));
  }, [id]);
  if (error) return <main className="print-page">{error}</main>;
  if (report === undefined) return <main className="print-page">Apertura del rapporto…</main>;
  if (!report) return <main className="print-page">Rapporto non trovato.</main>;
  const r = report.data;
  return (
    <main className="print-page">
      <div className="print-actions">
        {r.pdfFileId && (
          <a
            className="button primary"
            href={'/api/files?id=' + r.pdfFileId}
            target="_blank"
            rel="noreferrer"
          >
            <FileDown size={16} /> PDF archiviato
          </a>
        )}
        {r.audioFileId && (
          <a
            className="button secondary"
            href={'/api/files?id=' + r.audioFileId}
            target="_blank"
            rel="noreferrer"
          >
            <Headphones size={16} /> Registrazione originale
          </a>
        )}
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={16} /> Stampa
        </button>
      </div>
      <header className="print-head">
        <p className="eyebrow">BLINDO SERVICE · RAPPORTO DEL CONTROLLO</p>
        <h1>{r.meta?.authority}</h1>
        <p>
          {r.meta?.officers} · {stamp(r.meta?.started)} – {stamp(r.meta?.ended)}
        </p>
      </header>
      <section>
        <h2>Motivo dell’accertamento</h2>
        <p>{r.motivo || 'Non desumibile.'}</p>
        <h2>Sintesi</h2>
        <p>{r.sintesi}</p>
      </section>
      {r.possibiliViolazioni?.length > 0 && (
        <section>
          <h2>Possibili violazioni o irregolarità dell’agente</h2>
          {r.possibiliViolazioni.map((v: any, i: number) => (
            <article key={i} className="print-review">
              <strong>
                {v.titolo} · gravità {v.gravita}
              </strong>
              <p>{v.descrizione}</p>
              {v.citazione && <blockquote>«{v.citazione}»</blockquote>}
              <small>Riferimento: {v.riferimento || 'da individuare con il legale'}</small>
              {v.verifica && <small>Come verificare: {v.verifica}</small>}
            </article>
          ))}
        </section>
      )}
      {[
        ['Punti di forza', r.puntiForza],
        ['Punti deboli e rimedi', r.puntiDeboli],
      ].map(([title, list]: any) =>
        list?.length ? (
          <section key={title}>
            <h2>{title}</h2>
            <ul>
              {list.map((p: any, i: number) => (
                <li key={i}>
                  {p.testo}
                  {p.citazione && <small>«{p.citazione}»</small>}
                  {p.rimedio && <small>Rimedio: {p.rimedio}</small>}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {r.documentiRichiesti?.length > 0 && (
        <section>
          <h2>Documenti richiesti</h2>
          <ul>
            {r.documentiRichiesti.map((d: any, i: number) => (
              <li key={i}>
                {d.documento} — {d.esibito ? 'esibito' : 'non esibito'}
                {d.note && <small>{d.note}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.azioni?.length > 0 && (
        <section>
          <h2>Azioni consigliate</h2>
          <ul>
            {r.azioni.map((a: string, i: number) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <footer className="print-foot">
        Generato il {stamp(r.generatedAt)} con {r.model}. {r.citazioniScartate} citazioni non riscontrate
        nella trascrizione sono state eliminate. PDF SHA-256: {r.pdfSha256}. Le “possibili violazioni” sono
        ipotesi da valutare con un avvocato e non costituiscono accertamento di illeciti; verificare ogni
        passaggio ascoltando la registrazione originale.
      </footer>
    </main>
  );
}
