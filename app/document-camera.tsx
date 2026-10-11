'use client';
import { useEffect, useRef, useState } from 'react';
import { jpegPagesPdf, photoPage, type PhotoPage } from '@/lib/photo-pdf';
type Shot = PhotoPage & { id: string; url: string };
export default function DocumentCamera({
  disabled = false,
  onPdf,
  onSessionChange,
}: {
  disabled?: boolean;
  onPdf: (file: File) => Promise<void>;
  onSessionChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState(false),
    [waiting, setWaiting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [shots, setShots] = useState<Shot[]>([]);
  const stream = useRef<MediaStream | null>(null),
    video = useRef<HTMLVideoElement | null>(null),
    pages = useRef<Shot[]>([]),
    generation = useRef(0),
    locked = useRef(false),
    active = useRef(false);
  function release() {
    generation.current++;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    setReady(false);
    setWaiting(false);
  }
  function clear() {
    pages.current.forEach(x => URL.revokeObjectURL(x.url));
    pages.current = [];
    setShots([]);
  }
  useEffect(
    () => () => {
      generation.current++;
      stream.current?.getTracks().forEach(t => t.stop());
      pages.current.forEach(x => URL.revokeObjectURL(x.url));
    },
    [],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pages.current.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function start() {
    if (disabled || locked.current) return;
    active.current = true;
    setOpen(true);
    onSessionChange?.(true);
    setError('');
    release();
    setWaiting(true);
    const ticket = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('NO_CAMERA');
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
      if (ticket !== generation.current || !active.current) {
        media.getTracks().forEach(t => t.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (ticket === generation.current) setWaiting(false);
    } catch (e) {
      if (ticket !== generation.current) return;
      release();
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Consenti l’accesso alla fotocamera nelle impostazioni del browser, poi premi Riapri fotocamera.'
          : 'Fotocamera non disponibile. Puoi riaprire la fotocamera o usare lo scatto di sistema qui sotto.',
      );
    }
  }
  function append(page: PhotoPage) {
    if (pages.current.length >= 30)
      throw new Error('Massimo 30 pagine per documento. Crea questo PDF e prosegui con un altro.');
    if (pages.current.reduce((n, p) => n + p.jpeg.length, 0) + page.jpeg.length > 9.8 * 1024 * 1024)
      throw new Error(
        'Questo documento raggiunge il limite di analisi. Crea il PDF con le foto già presenti e aggiungi le altre in un secondo documento.',
      );
    const shot = {
      ...page,
      id: crypto.randomUUID(),
      url: URL.createObjectURL(new Blob([page.jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })),
    };
    pages.current = [...pages.current, shot];
    setShots(pages.current);
  }
  async function capture() {
    if (locked.current || !video.current?.videoWidth) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const v = video.current,
        scale = Math.min(1, 3200 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Scatto non disponibile.');
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Scatto non riuscito.'))), 'image/jpeg', 0.94),
      );
      append({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
      canvas.width = canvas.height = 1;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function addFiles(files: File[]) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    release();
    try {
      for (const file of files) append(await photoPage(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function remove(id: string) {
    const old = pages.current.find(x => x.id === id);
    if (old) URL.revokeObjectURL(old.url);
    pages.current = pages.current.filter(x => x.id !== id);
    setShots(pages.current);
  }
  function move(index: number, step: number) {
    const next = [...pages.current];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    pages.current = next;
    setShots(next);
  }
  function close() {
    if (locked.current) return;
    if (
      pages.current.length &&
      !window.confirm('Scartare le foto di questo documento? Non sono ancora state caricate.')
    )
      return;
    active.current = false;
    release();
    clear();
    setOpen(false);
    onSessionChange?.(false);
  }
  async function submit() {
    if (locked.current || !pages.current.length) return;
    locked.current = true;
    setBusy(true);
    setError('');
    release();
    try {
      const bytes = jpegPagesPdf(pages.current);
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error('PDF oltre 10 MB. Rimuovi alcune pagine e crea due documenti.');
      const file = new File(
        [bytes as Uint8Array<ArrayBuffer>],
        'Scansione-' + new Date().toISOString().replace(/[:.]/g, '-') + '.pdf',
        { type: 'application/pdf' },
      );
      await onPdf(file);
      active.current = false;
      clear();
      setOpen(false);
      onSessionChange?.(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button type="button" className="button secondary" disabled={disabled} onClick={() => void start()}>
        Carica foto · apri fotocamera
      </button>
    );
  return (
    <section className="panel" style={{ padding: 16, marginTop: 16 }} aria-label="Scansione documento">
      <h2>Fotografa le pagine del documento</h2>
      <p className="muted">
        Scatta una o più foto. Diventeranno le pagine di un unico PDF, nell’ordine qui sotto.
      </p>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setReady(true)}
        style={{
          display: stream.current ? 'block' : 'none',
          width: '100%',
          maxHeight: '50vh',
          objectFit: 'contain',
          background: '#10213f',
          borderRadius: 8,
          margin: '12px 0',
        }}
      />
      {waiting && <p role="status">Consenti l’accesso alla fotocamera sul dispositivo…</p>}
      <div className="row" style={{ margin: '12px 0' }}>
        <button
          type="button"
          className="button primary"
          disabled={busy || !ready}
          onClick={() => void capture()}
        >
          Scatta pagina {shots.length + 1}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy || waiting}
          onClick={() => void start()}
        >
          Riapri fotocamera
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={close}>
          Annulla scansione
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>Usa fotocamera di sistema o foto già scattate</summary>
        <label className="field">
          <span>Scatta un’altra pagina con la fotocamera di sistema</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onClick={() => release()}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              void addFiles(files);
            }}
          />
        </label>
        <label className="field">
          <span>Aggiungi una o più foto dalla galleria</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              void addFiles(files);
            }}
          />
        </label>
      </details>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        {shots.map((shot, i) => (
          <div key={shot.id} style={{ border: '1px solid #ccd7e6', borderRadius: 8, padding: 10 }}>
            <img
              src={shot.url}
              alt={'Pagina ' + (i + 1)}
              style={{ width: '100%', height: 180, objectFit: 'contain' }}
            />
            <strong>Pagina {i + 1}</strong>
            <div className="row">
              <button
                type="button"
                className="textbutton"
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                Prima
              </button>
              <button
                type="button"
                className="textbutton"
                disabled={busy || i === shots.length - 1}
                onClick={() => move(i, 1)}
              >
                Dopo
              </button>
              <button type="button" className="textbutton" disabled={busy} onClick={() => remove(shot.id)}>
                Elimina foto
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="formfooter">
        <button
          type="button"
          className="button primary"
          disabled={busy || !shots.length}
          onClick={() => void submit()}
        >
          {busy
            ? 'Preparazione…'
            : `Crea PDF e carica (${shots.length} ${shots.length === 1 ? 'pagina' : 'pagine'})`}
        </button>
      </div>
    </section>
  );
}
