'use client';
import './document-import.css';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import DocumentEditor from './document-editor';
import DocumentCamera from './document-camera';
import { documentPdf, fileKind } from '@/lib/photo-pdf';
type Item = {
  id: string;
  source: string;
  version: number;
  error: string;
  data: any;
  status: string;
  processing: boolean;
};
type Summary = {
  id: string;
  source: string;
  title: string;
  version: number;
  analyzed: boolean;
  error: string;
  processing: boolean;
};
type Local = { id: string; file: File; source: string };
async function api(body?: unknown, query = '') {
  const response = await fetch(
    '/api/documents/import' + query,
    body
      ? {
          method: 'POST',
          ...(body instanceof FormData
            ? { body }
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        }
      : { cache: 'no-store' },
  );
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(result.error || 'Operazione non riuscita.');
  return result;
}
export default function DocumentImporter({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [items, setItems] = useState<Summary[]>([]),
    [total, setTotal] = useState(0),
    [current, setCurrent] = useState<Item | null>(null),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [phase, setPhase] = useState(''),
    [error, setError] = useState(''),
    [remaining, setRemaining] = useState(0),
    [log, setLog] = useState<string[]>([]),
    [dirty, setDirty] = useState(false);
  const queue = useRef<Local[]>([]),
    stop = useRef(false),
    working = useRef(false),
    active = useRef<Item | null>(null),
    changed = useRef(false),
    formBusy = useRef(false);
  function select(item: Item | null) {
    active.current = item;
    setCurrent(item);
    changed.current = false;
    setDirty(false);
  }
  function note(text: string) {
    setLog(prev => [text, ...prev].slice(0, 30));
  }
  async function reload(more = false) {
    const offset = more ? items.length : 0;
    const result = await api(undefined, '?offset=' + offset);
    setItems(prev =>
      more ? [...prev, ...result.items.filter((i: Summary) => !prev.some(p => p.id === i.id))] : result.items,
    );
    setTotal(result.total);
    return result.items as Summary[];
  }
  useEffect(() => {
    if (open) void reload().catch(e => setError(e.message));
  }, [open]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (working.current || queue.current.length || changed.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function preserve() {
    if (active.current && changed.current) {
      const result = await api({
        action: 'draft',
        id: active.current.id,
        version: active.current.version,
        data: active.current.data,
      });
      select(result.item);
    }
  }
  async function choose(id: string) {
    if (formBusy.current) return;
    formBusy.current = true;
    setBusy(true);
    setError('');
    try {
      await preserve();
      const result = await api(undefined, '?id=' + encodeURIComponent(id));
      if (result.item.status !== 'pending')
        throw new Error('Questa bozza è già stata gestita. Aggiorna la coda.');
      select(result.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      formBusy.current = false;
      setBusy(false);
    }
  }
  async function analyze(item: Item) {
    const result = await api({ action: 'analyze', id: item.id, version: item.version });
    if (result.analysisFailed) note(item.source + ': ' + result.item.error);
    if (result.pause) {
      stop.current = true;
      setError(result.item.error + ' Importazione sospesa; le bozze caricate sono conservate.');
    }
    return result.item as Item;
  }
  async function process() {
    if (working.current) return;
    working.current = true;
    stop.current = false;
    setRunning(true);
    setError('');
    try {
      while (queue.current.length && !stop.current) {
        const task = queue.current[0];
        setPhase('Conversione e caricamento: ' + task.source);
        let pdf: File;
        try {
          pdf = await documentPdf(task.file);
        } catch (e) {
          note(task.source + ': ' + (e as Error).message);
          queue.current.shift();
          setRemaining(queue.current.length);
          continue;
        }
        const body = new FormData();
        body.append('id', task.id);
        body.append('source', task.source);
        body.append('file', pdf);
        // Keep the same id on network retry, including ambiguous upload responses.
        const result = await api(body);
        queue.current.shift();
        setRemaining(queue.current.length);
        if (result.duplicate) {
          note(task.source + ': già presente, non duplicato.');
          if (!active.current && result.item?.status === 'pending') select(result.item);
        } else {
          let item = result.item as Item;
          setPhase('Lettura e classificazione: ' + task.source);
          if (!stop.current) {
            try {
              item = await analyze(item);
            } catch (e) {
              note(task.source + ': ' + (e as Error).message);
            }
          }
          if (!active.current) select(item);
        }
        await reload();
      }
      setPhase(
        queue.current.length
          ? 'Importazione in pausa. I documenti già caricati sono conservati.'
          : 'Caricamento terminato. Conferma le schede una per volta.',
      );
    } catch (e) {
      setError((e as Error).message + ' Premi Riprendi per riprovare lo stesso file.');
      setPhase('Importazione in pausa.');
    } finally {
      working.current = false;
      setRunning(false);
    }
  }
  function add(files: FileList | null) {
    if (!files) return;
    let accepted = 0,
      rejected = 0,
      bytes = 0;
    const seen = new Set(queue.current.map(x => [x.source, x.file.size, x.file.lastModified].join('|')));
    for (const file of Array.from(files)) {
      const source = file.webkitRelativePath || file.name,
        key = [source, file.size, file.lastModified].join('|');
      if (source.split('/').some(p => p.startsWith('.')) || fileKind(file) === 'unsupported') {
        rejected++;
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      queue.current.push({ id: crypto.randomUUID(), file, source });
      accepted++;
      bytes += file.size;
    }
    setRemaining(queue.current.length);
    note(
      `${accepted} file aggiunti (${(bytes / 1024 / 1024).toFixed(1)} MB); ${rejected} file nascosti o non supportati esclusi.`,
    );
    setPhase('Pronto: premi Avvia importazione.');
  }
  async function resumeAnalysis() {
    if (working.current || formBusy.current) return;
    await preserve();
    working.current = true;
    stop.current = false;
    setRunning(true);
    setError('');
    try {
      let offset = 0,
        rows: Summary[] = [];
      while (true) {
        const page = await api(undefined, '?offset=' + offset);
        rows.push(...page.items);
        offset += page.items.length;
        if (offset >= page.total || !page.items.length) break;
      }
      for (const row of rows) {
        if (stop.current) break;
        if (
          row.analyzed ||
          row.version !== 1 ||
          row.processing ||
          (row.id === active.current?.id && changed.current)
        )
          continue;
        setPhase('Lettura della bozza: ' + row.source);
        const result = await api(undefined, '?id=' + encodeURIComponent(row.id));
        if (result.item.status !== 'pending' || result.item.version !== 1) continue;
        const item = await analyze(result.item);
        if (!active.current || active.current.id === item.id) select(item);
        await reload();
      }
      setPhase(
        'Analisi delle nuove bozze terminata. Le bozze modificate o con errore si rileggono singolarmente.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      working.current = false;
      setRunning(false);
    }
  }
  async function finish(action: 'save' | 'discard' | 'draft' | 'analyze') {
    const item = active.current;
    if (!item || formBusy.current || working.current) return;
    if (
      action === 'discard' &&
      !window.confirm(
        'Eliminare definitivamente questa bozza e il PDF caricato? Il file sul tuo dispositivo non viene toccato.',
      )
    )
      return;
    if (
      action === 'analyze' &&
      !window.confirm('Rileggere il PDF e sostituire i dati proposti in questa bozza?')
    )
      return;
    formBusy.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'analyze') {
        await preserve();
        select(await analyze(active.current!));
        await reload();
        return;
      }
      const result = await api({ action, id: item.id, version: item.version, data: item.data });
      if (action === 'draft') {
        select(result.item);
        setPhase('Bozza e modifiche conservate.');
        await reload();
        return;
      }
      select(null);
      const rows = await reload();
      if (rows.length) {
        const next = await api(undefined, '?id=' + encodeURIComponent(rows[0].id));
        select(next.item);
      }
      if (action === 'save') {
        note('Archiviato: ' + item.data.title);
        await onSaved();
      } else note('Eliminato: ' + item.source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      formBusy.current = false;
      setBusy(false);
    }
  }
  async function cameraPdf(file: File) {
    if (working.current || formBusy.current)
      throw new Error('Attendi il completamento dell’operazione in corso.');
    working.current = true;
    setRunning(true);
    setError('');
    try {
      await preserve();
      setPhase('Caricamento del PDF fotografico…');
      const body = new FormData();
      body.append('id', crypto.randomUUID());
      body.append('source', file.name);
      body.append('file', file);
      const result = await api(body);
      if (result.item?.status === 'pending') {
        let item = result.item as Item;
        if (!item.data.recognition && item.version === 1) {
          setPhase('Analisi del PDF fotografico…');
          item = await analyze(item);
        }
        select(item);
      }
      await reload();
      setPhase('PDF fotografico caricato. Controlla e conferma la scheda.');
    } finally {
      working.current = false;
      setRunning(false);
    }
  }
  async function close() {
    if (working.current || formBusy.current) return;
    if (cameraOpen) {
      setError('Completa il PDF oppure premi Annulla scansione prima di chiudere.');
      return;
    }
    formBusy.current = true;
    setBusy(true);
    try {
      await preserve();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      formBusy.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v: boolean) => {
        if (!v) void close();
      }}
    >
      <DialogContent className="presidio-dialog document-import-dialog">
        <DialogTitle>Importa e registra i documenti</DialogTitle>
        <DialogDescription>
          Cartelle, documenti e fotocamera. Ogni PDF resta in una coda riservata finché lo confermi o elimini.
        </DialogDescription>
        <section className="panel import-controls">
          <h2>1. Aggiungi i documenti</h2>
          <p className="muted">
            Le fotografie diventano PDF prima dell’analisi. Con Carica foto puoi riunire più scatti in un
            unico PDF. Le immagini importate da una cartella restano documenti separati. I documenti vengono
            inviati a OpenAI per estrarre i dati.
          </p>
          <div className="formgrid">
            <label className="field">
              <span>Carica una cartella, incluse le sottocartelle</span>
              <input
                disabled={running || busy || cameraOpen}
                type="file"
                multiple
                {...({ webkitdirectory: '', directory: '' } as any)}
                onChange={e => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="field">
              <span>Seleziona più documenti o immagini</span>
              <input
                disabled={running || busy || cameraOpen}
                type="file"
                multiple
                accept="application/pdf,image/*"
                onChange={e => {
                  add(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <DocumentCamera disabled={running || busy} onSessionChange={setCameraOpen} onPdf={cameraPdf} />
          <p className="smallnote">
            Cartelle elaborate un file alla volta. Massimo 20 MB per file; analisi automatica fino a 10 MB.
            Per trasferire i file lascia questa pagina aperta. I file ancora sul dispositivo vanno
            riselezionati se chiudi o ricarichi la pagina; quelli già sul server rimangono nella coda.
          </p>
          <div className="row" style={{ marginTop: 16 }}>
            {running ? (
              <button
                className="button secondary"
                onClick={() => {
                  stop.current = true;
                  setPhase('Pausa richiesta: completo il documento in corso…');
                }}
              >
                Pausa dopo questo documento
              </button>
            ) : (
              <>
                <button
                  className="button primary"
                  disabled={!remaining || busy || cameraOpen}
                  onClick={() => void process()}
                >
                  {phase.includes('pausa') ? 'Riprendi' : 'Avvia importazione'} ({remaining})
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !total || cameraOpen}
                  onClick={() => void resumeAnalysis().catch(e => setError(e.message))}
                >
                  Analizza nuove bozze caricate
                </button>
              </>
            )}
          </div>
          <p role="status" aria-live="polite" className="smallnote">
            {phase}
          </p>
          {!!log.length && (
            <details>
              <summary>Esito dei file elaborati</summary>
              {log.map((line, i) => (
                <p className="smallnote" key={i}>
                  {line}
                </p>
              ))}
            </details>
          )}
        </section>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <h2>2. Conferma un documento alla volta · {total} in attesa</h2>
        <p className="smallnote">
          Durante l’importazione puoi seguire l’anteprima. Metti in pausa per modificare, salvare o eliminare
          le schede.
        </p>
        <div className="import-layout">
          <aside className="import-list">
            <button
              type="button"
              className="textbutton"
              disabled={busy || running || cameraOpen}
              onClick={() => void reload().catch(e => setError(e.message))}
            >
              Aggiorna coda
            </button>
            {items.map(item => (
              <button
                key={item.id}
                disabled={busy || running || cameraOpen}
                className={'import-item ' + (current?.id === item.id ? 'selected' : '')}
                onClick={() => void choose(item.id)}
              >
                <strong>{item.title || item.source.split('/').pop()}</strong>
                <small>{item.source}</small>
                <span>
                  {item.processing
                    ? 'Analisi in corso'
                    : item.error
                      ? 'Da controllare'
                      : item.analyzed
                        ? 'Da confermare'
                        : 'Da analizzare'}
                </span>
              </button>
            ))}
            {items.length < total && (
              <button
                className="button secondary"
                disabled={busy || running || cameraOpen}
                onClick={() => void reload(true).catch(e => setError(e.message))}
              >
                Mostra altri
              </button>
            )}
          </aside>
          <div>
            {current ? (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void finish('save');
                }}
                key={current.id}
              >
                <p className="smallnote">
                  {current.source}
                  {dirty ? ' · Modifiche da conservare' : ''}
                </p>
                {current.error && (
                  <p className="notice error">
                    {current.error} Puoi correggere la scheda manualmente o rileggere il PDF.
                  </p>
                )}
                <DocumentEditor
                  hideSource
                  value={current.data}
                  onChange={data => {
                    const updated = { ...current, data };
                    active.current = updated;
                    setCurrent(updated);
                    changed.current = true;
                    setDirty(true);
                  }}
                  busy={busy || running || cameraOpen}
                  onBusy={setBusy}
                />
                <div className="import-actions">
                  <button
                    type="button"
                    className="button danger"
                    disabled={busy || running || cameraOpen}
                    onClick={() => void finish('discard')}
                  >
                    Elimina documento
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || running || cameraOpen}
                    onClick={() => void finish('analyze')}
                  >
                    Rileggi PDF
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || running || cameraOpen}
                    onClick={() => void finish('draft')}
                  >
                    Conserva bozza
                  </button>
                  <button className="button primary" disabled={busy || running || cameraOpen}>
                    Salva e passa al prossimo
                  </button>
                </div>
              </form>
            ) : (
              <p className="panel muted">
                {total
                  ? 'Scegli una bozza dalla coda.'
                  : 'Carica una cartella o scatta una foto per iniziare.'}
              </p>
            )}
          </div>
        </div>
        <div className="formfooter">
          <button
            className="button secondary"
            disabled={running || busy || cameraOpen}
            onClick={() => void close()}
          >
            Chiudi e conserva la coda
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
