'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Search, ShieldCheck, LogOut, X, Clock, ExternalLink } from 'lucide-react';
type Doc = { id: string; title: string; description: string; version: string };
export default function InspectorPortal({ portal }: { portal: string }) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<Doc[] | null>(null),
    [view, setView] = useState<any>(null),
    [finished, setFinished] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    office: '',
    role: '',
    plate: '',
    purpose: '',
    noticeRead: false,
  });
  const started = useRef(false);
  async function post(action: string, data: any = {}) {
    const r = await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, portal, ...data }),
    });
    const d: any = await r.json();
    if (!r.ok) throw new Error(d.error || 'Operazione non riuscita');
    return d;
  }
  async function refresh() {
    const r = await fetch('/api/portal?portal=' + portal, { cache: 'no-store' });
    const d: any = await r.json();
    if (!r.ok) throw new Error(d.error);
    setState(d);
    if (d.visit?.status !== 'autorizzata') setView(null);
    return d;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(async () => {
      await post('start');
      await refresh();
    });
  }, []);
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => {
      refresh().catch(e => {
        setError(e.message);
        setView(null);
      });
      post('heartbeat').catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [finished]);
  const status = state?.visit?.status;
  return (
    <div className="visitor">
      <header>
        <ShieldCheck size={27} />
        <div>
          <strong>{state?.company || 'Archivio documentale'}</strong>
          <small>Consultazione per il controllo</small>
        </div>
      </header>
      <main>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              onClick={() =>
                run(async () => {
                  await refresh();
                })
              }
            >
              Riprova
            </button>
          </div>
        )}
        {finished ? (
          <section className="panel empty">
            <ShieldCheck />
            <h1>Sessione terminata</h1>
            <p>L’accesso ai documenti è chiuso.</p>
          </section>
        ) : !state ? (
          <p className="panel">Apertura della sessione…</p>
        ) : !status || status === 'chiusa' ? (
          <section className="panel">
            <h1>Sessione conclusa</h1>
            <p>Chiedere al responsabile l’esibizione dei documenti o avviare un nuovo accesso.</p>
            <button
              className="button secondary"
              onClick={() =>
                run(async () => {
                  await post('start');
                  await refresh();
                })
              }
            >
              Nuovo accesso
            </button>
          </section>
        ) : status === 'identificazione' ? (
          <section className="panel">
            <p className="eyebrow">ACCESSO ALLA CONSULTAZIONE</p>
            <h1>Dati del controllo</h1>
            <p className="muted">Il responsabile verifica la richiesta e abilita i documenti pertinenti.</p>
            <form
              onSubmit={e => {
                e.preventDefault();
                run(async () => {
                  await post('identify', { data: form });
                  await refresh();
                });
              }}
            >
              <div className="formgrid">
                {(
                  [
                    ['firstName', 'Nome'],
                    ['lastName', 'Cognome'],
                    ['office', 'Ente e ufficio'],
                    ['role', 'Qualifica / ruolo'],
                    ['purpose', 'Oggetto del controllo'],
                    ['plate', 'Targa del veicolo (facoltativa)'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>
                      {label}
                      {key !== 'plate' ? ' *' : ''}
                    </span>
                    <input
                      required={key !== 'plate'}
                      maxLength={key === 'plate' ? 20 : 200}
                      autoComplete="off"
                      value={form[key]}
                      onChange={e => setForm({ ...form, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <details className="privacyinfo">
                <summary>Informazioni sui dati della sessione</summary>
                <p>
                  I dati dichiarati, gli orari, le ricerche e i documenti aperti vengono registrati e sono
                  visibili al responsabile dell’attività per gestire e documentare il controllo. Il nome
                  inserito non costituisce verifica dell’identità.
                </p>
                <p className="noticetext">{state?.notice}</p>
                <p>
                  Questo portale non attiva il microfono del visitatore. La presa visione non equivale a un
                  consenso generale alla registrazione o a un’accettazione dei fatti del controllo.
                </p>
              </details>
              <label className="checkrow">
                <input
                  type="checkbox"
                  required
                  checked={form.noticeRead}
                  onChange={e => setForm({ ...form, noticeRead: e.target.checked })}
                />
                Ho letto le informazioni sulla sessione.
              </label>
              <button className="button primary" disabled={busy}>
                Richiedi i documenti
              </button>
            </form>
          </section>
        ) : status === 'in_attesa' ? (
          <section className="panel empty">
            <Clock />
            <h1>Richiesta inviata</h1>
            <p>Il responsabile sta verificando l’accesso. La pagina si aggiorna automaticamente.</p>
          </section>
        ) : (
          <>
            <div className="sectiontitle">
              <div>
                <p className="eyebrow">DOCUMENTI AUTORIZZATI PER QUESTA SESSIONE</p>
                <h1>Quale documento cerca?</h1>
                <p>Inserire il titolo o una parola chiave.</p>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post('finish');
                    setView(null);
                    setFinished(true);
                  })
                }
              >
                <LogOut size={16} />
                Termina
              </button>
            </div>
            <form
              className="toolbar"
              onSubmit={e => {
                e.preventDefault();
                run(async () => {
                  const d = await post('search', { query });
                  setResults(d.documents);
                  await refresh();
                });
              }}
            >
              <div className="searchbox">
                <Search size={19} />
                <input
                  required
                  minLength={2}
                  maxLength={150}
                  aria-label="Documento da cercare"
                  placeholder="Es. planimetria, SCIA, HACCP…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <button className="button primary" disabled={busy}>
                Cerca
              </button>
            </form>
            {results && (
              <section>
                <h2>Risultati della ricerca</h2>
                {!results.length && (
                  <p className="panel">
                    Nessun documento abilitato corrisponde alla ricerca. Chiedere al responsabile di esibirlo
                    o abilitarlo.
                  </p>
                )}
                <div className="documentgrid">
                  {results.map(d => (
                    <button
                      className="documentcard visitorfile"
                      key={d.id}
                      onClick={() =>
                        run(async () => {
                          const o = await post('open', { documentId: d.id });
                          setView({ ...d, url: o.url });
                          await refresh();
                        })
                      }
                    >
                      <FileText />
                      <h3>{d.title}</h3>
                      <p>{d.description}</p>
                      <span className="textbutton">Apri documento</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {state?.haccp?.url && (
              <section className="panel haccplink">
                <p className="eyebrow">REGISTRI HACCP DEL LOCALE</p>
                <p>
                  Temperature, pulizie e non conformità sono registrate nel gestionale del locale, in una
                  pagina di sola consultazione.
                </p>
                <a
                  className="button secondary"
                  href={state.haccp.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} />
                  Apri i registri HACCP
                </a>
                {state.haccp.scade && (
                  <p className="smallnote">
                    Link valido fino al {new Date(state.haccp.scade).toLocaleDateString('it-IT')}.
                  </p>
                )}
              </section>
            )}
            <section className="historydocs">
              <h2>Documenti ricercati in questa sessione</h2>
              {!state.history?.length ? (
                <p className="muted">
                  Qui compariranno esclusivamente i documenti restituiti dalle ricerche.
                </p>
              ) : (
                state.history.map((d: Doc) => (
                  <button
                    className="linkedfile"
                    key={d.id}
                    onClick={() =>
                      run(async () => {
                        const o = await post('open', { documentId: d.id });
                        setView({ ...d, url: o.url });
                      })
                    }
                  >
                    <FileText />
                    <span>
                      {d.title}
                      <small>{d.description}</small>
                    </span>
                  </button>
                ))
              )}
            </section>
          </>
        )}
        {!finished && (
          <div className="assisted">
            <p>
              Per l’esibizione assistita dei documenti è possibile rivolgersi direttamente al responsabile,
              anche senza compilare il modulo.
            </p>
            <button
              className="textbutton"
              disabled={busy || !state}
              onClick={() =>
                run(async () => {
                  await post('help');
                  setError('Richiesta di assistenza registrata. Rivolgersi al responsabile presente.');
                })
              }
            >
              Richiedi esibizione assistita
            </button>
          </div>
        )}
      </main>
      {view && (
        <div className="documentviewer" role="dialog" aria-modal="true" aria-label={view.title}>
          <header>
            <strong>{view.title}</strong>
            <button
              className="button secondary"
              onClick={() =>
                run(async () => {
                  await post('closeDocument');
                  setView(null);
                })
              }
            >
              <X />
              Chiudi
            </button>
          </header>
          <iframe title={view.title} src={view.url} />
          <a href={view.url} target="_blank" rel="noreferrer">
            Apri il documento in una scheda
          </a>
        </div>
      )}
    </div>
  );
}
