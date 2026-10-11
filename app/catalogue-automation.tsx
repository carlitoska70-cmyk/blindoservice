'use client';
import { useEffect, useRef, useState } from 'react';
import { allCatalogue } from '@/lib/catalogue-index';
import { normalized } from '@/lib/catalogue-matching';
const labels: Record<string, string> = {
  queued: 'Da leggere',
  processing: 'Lettura in corso',
  review: 'Verifica umana',
  applied: 'Abbinati',
  skipped: 'Senza modifiche',
  error: 'Lettura non riuscita',
  conflict: 'Scheda modificata',
  rejected: 'Non abbinati per scelta',
  undone: 'Abbinamento annullato',
};
async function api(body?: any, query = '') {
  const r = await fetch(
    '/api/documents/catalogue' + query,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  let data: any;
  try {
    data = await r.json();
  } catch {
    throw new Error('Risposta interrotta. Premi Aggiorna: i risultati salvati restano disponibili.');
  }
  if (!r.ok)
    throw new Error(
      data.error ||
        (data.status === 'conflict'
          ? 'La scheda è cambiata: rileggi prima di confermare.'
          : 'Operazione non riuscita.'),
    );
  return data;
}
function Review({ item, disabled, onAction, onDocument }: any) {
  const [ids, setIds] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [note, setNote] = useState(''),
    [preview, setPreview] = useState(false);
  const candidates = item.analysis?.candidates || [],
    recognition = item.analysis?.recognition;
  const options = allCatalogue.filter(c =>
    normalized([c.title, c.area].join(' ')).includes(normalized(query)),
  );
  function toggle(id: string) {
    setIds(old => (old.includes(id) ? old.filter(x => x !== id) : old.length < 20 ? [...old, id] : old));
  }
  return (
    <article className="catalog-review">
      <div className="sectionhead">
        <h3>{item.title || item.fileName}</h3>
        <span className="badge">{labels[item.status]}</span>
      </div>
      <p className="muted">
        {item.fileName} · {item.reason}
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        {item.fileId && (
          <>
            <a
              className="textbutton"
              href={'/api/files?id=' + encodeURIComponent(item.fileId)}
              target="_blank"
              rel="noreferrer"
            >
              Apri originale
            </a>
            <button type="button" className="textbutton" onClick={() => setPreview(!preview)}>
              {preview ? 'Chiudi anteprima' : 'Mostra anteprima'}
            </button>
          </>
        )}
        <button
          type="button"
          className="textbutton"
          disabled={disabled}
          onClick={() => onDocument(item.documentId)}
        >
          Apri scheda corrente
        </button>
      </div>
      {preview && (
        <iframe
          title={'Originale: ' + item.title}
          src={'/api/files?id=' + encodeURIComponent(item.fileId)}
          style={{ width: '100%', height: 440, border: '1px solid #ccd7e6', marginTop: 12 }}
        />
      )}
      {recognition && (
        <details style={{ marginTop: 12 }}>
          <summary>Lettura e motivazione dell’abbinamento</summary>
          <p className="smallnote">
            Letto: {item.analysis.readAt} · modello: {recognition.model}. La classificazione non certifica
            validità o regolarità.
          </p>
          {['title', 'documentType', 'vat', 'address', 'issued', 'expires'].map(k => {
            const f = recognition.fields?.[k];
            return f?.value ? (
              <p key={k} className="smallnote">
                <strong>
                  {
                    (
                      {
                        title: 'Titolo',
                        documentType: 'Tipo',
                        vat: 'Partita IVA',
                        address: 'Sede',
                        issued: 'Rilasciato',
                        expires: 'Scadenza',
                      } as any
                    )[k]
                  }
                  : {f.value}
                </strong>{' '}
                · lettura {f.confidence}
                {f.page ? ' · pag. ' + f.page : ''}
                <br />
                {f.evidence}
              </p>
            ) : null;
          })}
          {candidates.map((c: any) => (
            <p key={c.id} className="smallnote">
              {c.title} · {c.reason}
            </p>
          ))}
        </details>
      )}
      {!!item.analysis?.reasons?.length && (
        <ul className="catalog-reasons">
          {item.analysis.reasons.map((r: string, i: number) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {item.status === 'review' && (
        <fieldset disabled={disabled} style={{ border: 0, padding: 0, marginTop: 14 }}>
          <p className="muted">Scegli una o più voci dopo aver controllato l’originale.</p>
          {candidates.map((c: any) => (
            <label className="checkrow" key={c.id}>
              <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.title}
            </label>
          ))}
          <label className="field">
            <span>Cerca altre voci</span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
          <label className="field">
            <span>Aggiungi una voce del catalogo</span>
            <select
              value=""
              onChange={e => {
                if (e.target.value) toggle(e.target.value);
              }}
            >
              <option value="">Scegli…</option>
              {options
                .filter(c => !ids.includes(c.id))
                .map(c => (
                  <option value={c.id} key={c.id}>
                    {c.area} · {c.title}
                  </option>
                ))}
            </select>
          </label>
          {ids.map(id => (
            <div key={id} className="row">
              <span>{allCatalogue.find(c => c.id === id)?.title || id}</span>
              <button type="button" className="textbutton" onClick={() => toggle(id)}>
                Rimuovi
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button primary compact"
            style={{ marginTop: 12 }}
            disabled={!ids.length}
            onClick={() => onAction('approve', item, { ids })}
          >
            Conferma {ids.length || ''} abbinamenti
          </button>
          <label className="field" style={{ marginTop: 18 }}>
            <span>Oppure non abbinare: indica il motivo</span>
            <input
              value={note}
              maxLength={1000}
              onChange={e => setNote(e.target.value)}
              placeholder="Es. documento estraneo alla sede"
            />
          </label>
          <button
            type="button"
            className="button secondary compact"
            disabled={note.trim().length < 3}
            onClick={() => onAction('reject', item, { note })}
          >
            Non abbinare
          </button>
        </fieldset>
      )}
      {['error', 'conflict', 'review'].includes(item.status) && (
        <button
          type="button"
          className="textbutton"
          style={{ marginTop: 15 }}
          disabled={disabled}
          onClick={() => onAction('retry', item)}
        >
          Rimetti in coda per nuova lettura
        </button>
      )}
      {item.status === 'applied' && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            Voci aggiunte:{' '}
            {(item.added || [])
              .map((id: string) => allCatalogue.find(c => c.id === id)?.title || id)
              .join('; ')}
          </p>
          <button
            type="button"
            className="textbutton"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  'Annullare solo i collegamenti aggiunti da questa sessione? Gli originali resteranno in archivio.',
                )
              )
                onAction('undo', item);
            }}
          >
            Annulla questi abbinamenti
          </button>
        </div>
      )}
    </article>
  );
}
export default function CatalogueAutomation({
  onRefresh,
  onDocument,
  busy = false,
}: {
  onRefresh: () => Promise<any>;
  onDocument: (id: string) => void;
  busy?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [running, setRunning] = useState(false),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('review'),
    [offset, setOffset] = useState(0);
  const run = useRef(false),
    alive = useRef(true),
    jobRef = useRef(''),
    filterRef = useRef(filter),
    offsetRef = useRef(offset),
    refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  async function refresh(
    job = jobRef.current,
    state = filterRef.current,
    start = offsetRef.current,
  ): Promise<any> {
    const result = await api(
      undefined,
      '?' + new URLSearchParams({ ...(job ? { job } : {}), state, offset: String(start) }),
    );
    const count =
      state === 'all'
        ? Object.values(result.counts || {}).reduce((n: number, v: any) => n + Number(v), 0)
        : Number(result.counts?.[state] || 0);
    if (start > 0 && start >= count) {
      const next = Math.max(0, Math.floor((count - 1) / 20) * 20);
      offsetRef.current = next;
      if (alive.current) setOffset(next);
      return refresh(job, state, next);
    }
    if (alive.current) {
      setData(result);
      jobRef.current = result.job?.id || '';
    }
    return result;
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch(e => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      run.current = false;
    };
  }, []);
  async function process(job: string) {
    if (run.current) return;
    run.current = true;
    setRunning(true);
    setError('');
    setMessage('Rilettura degli originali in corso…');
    try {
      while (run.current && alive.current) {
        const result = await api({ action: 'step', job });
        await refresh(job);
        if (result.stop) {
          setMessage(
            'Scansione sospesa per un errore del servizio. Controlla “Lettura non riuscita” prima di riprendere.',
          );
          break;
        }
        if (result.busy) {
          setMessage('Un documento è già in lavorazione. Attendi fino a due minuti, poi premi Riprendi.');
          break;
        }
        if (result.done) {
          setMessage('Scansione completata. Controlla le verifiche umane e gli eventuali errori.');
          break;
        }
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      run.current = false;
      if (alive.current) {
        setRunning(false);
        await refreshRef
          .current()
          .catch(() => setError('Risultati salvati; aggiorna l’archivio per visualizzarli.'));
      }
    }
  }
  async function start() {
    setWorking(true);
    setError('');
    try {
      const result = await api({ action: 'start', confirm: true });
      jobRef.current = result.job;
      offsetRef.current = 0;
      setOffset(0);
      await refresh(result.job, filterRef.current, 0);
      await process(result.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  async function action(action: string, item: any, extra: any = {}) {
    setWorking(true);
    setError('');
    try {
      await api({ action, job: jobRef.current, id: item.id, ...extra });
      await refresh();
      await refreshRef.current();
      setMessage(
        action === 'retry' ? 'Documento rimesso in coda. Premi Riprendi scansione.' : 'Operazione salvata.',
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setWorking(false);
    }
  }
  async function view(state: string, start = 0, job = jobRef.current) {
    filterRef.current = state;
    offsetRef.current = start;
    setFilter(state);
    setOffset(start);
    setError('');
    try {
      await refresh(job, state, start);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function exportReport() {
    setWorking(true);
    setError('');
    try {
      const items: any[] = [];
      let start = 0;
      while (true) {
        const page = await api(
          undefined,
          '?' +
            new URLSearchParams({ job: jobRef.current, state: 'all', offset: String(start), limit: '100' }),
        );
        items.push(...page.items);
        if (page.items.length < 100) break;
        start += 100;
      }
      const report = {
        generatedAt: new Date().toISOString(),
        job: data.job,
        scope:
          'Classificazione documentale; non è una valutazione di conformità né una certificazione probatoria.',
        items,
      };
      const u = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = u;
      a.download = 'resoconto-abbinamenti-' + jobRef.current + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const counts = data?.counts || {},
    total = Object.values(counts).reduce((n: any, v: any) => n + Number(v), 0) as number,
    pending = (counts.queued || 0) + (counts.processing || 0),
    shown = filter === 'all' ? total : counts[filter] || 0;
  return (
    <section className="panel catalogue-automation">
      <div className="sectionhead">
        <div>
          <p className="eyebrow">RILETTURA DELL’ARCHIVIO</p>
          <h2>Abbina in automatico</h2>
        </div>
        <span className="badge">{total ? `${total - pending} / ${total} elaborati` : 'Pronto'}</span>
      </div>
      <p className="muted">
        Rilegge gli originali salvati, aggiunge le corrispondenze più solide e mette in verifica quelle
        dubbie. Mantiene i dati della scheda e i collegamenti esistenti. Anche un abbinamento automatico può
        essere corretto o annullato.
      </p>
      <p className="smallnote">
        La scansione procede mentre questa pagina è aperta. Chiudendola si ferma dopo il documento in corso;
        puoi riprenderla. I file nuovi richiedono una nuova scansione. La rilettura usa la chiave OpenAI
        configurata e può generare costi API; resta il limite di lettura di 10 MB per originale.
      </p>
      <div className="row">
        <button
          type="button"
          className="button primary"
          disabled={running || working || busy || !data}
          onClick={() => void start()}
        >
          Abbina in automatico
        </button>
        {pending > 0 && (
          <button
            type="button"
            className="button secondary"
            disabled={running || working || busy}
            onClick={() => void process(jobRef.current)}
          >
            Riprendi scansione
          </button>
        )}
        {running && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              run.current = false;
              setMessage('Pausa richiesta: termino e salvo il documento in corso.');
            }}
          >
            Pausa dopo questo documento
          </button>
        )}
        <button
          type="button"
          className="textbutton"
          disabled={running || working}
          onClick={() => void refresh().catch(e => setError(e.message))}
        >
          Aggiorna
        </button>
        {data?.job && (
          <button
            type="button"
            className="textbutton"
            disabled={running || working}
            onClick={() => void exportReport()}
          >
            Esporta resoconto
          </button>
        )}
      </div>
      <p role="status" className="smallnote">
        {message}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {data?.job && (
        <>
          <progress
            max={Math.max(1, total)}
            value={total - pending}
            style={{ width: '100%', marginTop: 14 }}
            aria-label="Documenti elaborati"
          />
          <div className="row catalog-job-counts">
            {Object.entries(labels)
              .filter(([key]) => counts[key])
              .map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className="button secondary compact"
                  disabled={running || working}
                  onClick={() => void view(key)}
                >
                  {label}: {counts[key]}
                </button>
              ))}
          </div>
          <div className="formgrid" style={{ marginTop: 16 }}>
            <label className="field">
              <span>Risultati da mostrare</span>
              <select value={filter} disabled={running || working} onChange={e => void view(e.target.value)}>
                <option value="all">Tutti</option>
                {Object.entries(labels).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sessione (ultime 10)</span>
              <select
                value={data.job.id}
                disabled={running || working}
                onChange={e => void view(filter, 0, e.target.value)}
              >
                {data.jobs.map((j: any) => (
                  <option key={j.id} value={j.id}>
                    {new Date(j.created).toLocaleString('it-IT')}
                    {j.active ? ' · da completare' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!data.items.length && <p className="muted">Nessun documento in questo stato.</p>}
          {data.items.map((item: any) => (
            <Review
              key={item.id + item.status + item.updated}
              item={item}
              disabled={running || working || busy}
              onAction={action}
              onDocument={onDocument}
            />
          ))}
          <div className="row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="button secondary compact"
              disabled={!offset || running || working}
              onClick={() => void view(filter, Math.max(0, offset - 20))}
            >
              Precedenti
            </button>
            <span className="smallnote">
              {shown ? offset + 1 : 0}–{Math.min(offset + 20, shown)} di {shown}
            </span>
            <button
              type="button"
              className="button secondary compact"
              disabled={offset + 20 >= shown || running || working}
              onClick={() => void view(filter, offset + 20)}
            >
              Successivi
            </button>
          </div>
        </>
      )}
    </section>
  );
}
