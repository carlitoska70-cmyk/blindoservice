'use client';
import { useRef, useState } from 'react';
import { categories } from '@/lib/product';
import type { FieldKey, Recognition } from '@/lib/document-recognition';
import { documentPdf, fileKind } from '@/lib/photo-pdf';
import DocumentCamera from './document-camera';
import DocumentCatalogue from './document-catalogue';
const labels: Record<FieldKey, string> = {
  title: 'Titolo del documento',
  category: 'Categoria',
  documentType: 'Tipo di documento',
  issuer: 'Ente / soggetto emittente',
  holder: 'Intestatario',
  vat: 'Partita IVA dell’intestatario',
  address: 'Sede riportata',
  protocol: 'Protocollo / riferimento',
  issued: 'Data di rilascio / atto',
  expires: 'Scadenza esplicitamente indicata',
  publicDescription: 'Descrizione visibile nel portale',
};
const limits: Record<string, number> = {
  title: 200,
  documentType: 200,
  issuer: 200,
  holder: 200,
  vat: 30,
  address: 300,
  protocol: 200,
  publicDescription: 500,
};
export default function DocumentEditor({
  value,
  onChange,
  busy,
  onBusy,
  hideSource = false,
}: {
  value: any;
  onChange: (value: any) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  hideSource?: boolean;
}) {
  const [phase, setPhase] = useState(''),
    [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const running = useRef(false);
  const recognition = value.recognition as Recognition | undefined;
  async function analyze(data: any) {
    setPhase('Lettura e classificazione del documento…');
    const response = await fetch('/api/documents/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || 'Analisi non riuscita. Puoi compilare manualmente.');
    if (result.fileId !== data.fileId) throw new Error('Risposta non associata al documento selezionato.');
    const recognized = result.recognition as Recognition;
    const next = { ...data, recognition: recognized, reviewed: false, reviewer: '' };
    for (const key of Object.keys(labels) as FieldKey[])
      next[key] = recognized.fields[key].value || (key === 'category' ? 'Altro' : '');
    onChange(next);
    setPhase('Scheda proposta: controlla i dati e premi Salva.');
  }
  async function select(file: File, propagate = false) {
    if (running.current) return;
    if (fileKind(file) === 'unsupported') {
      setError('Usa un PDF o una fotografia.');
      return;
    }
    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
      setError('Scegli un file non vuoto, fino a 20 MB.');
      return;
    }
    if (
      (value.fileId || value.title) &&
      !window.confirm(
        'Il nuovo allegato sostituirà la proposta e i dati del documento in questa scheda. Continuare?',
      )
    )
      return;
    running.current = true;
    onBusy(true);
    setError('');
    setPhase('Caricamento dell’originale…');
    try {
      setPhase('Preparazione del PDF…');
      file = await documentPdf(file);
      setPhase('Caricamento del PDF…');
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/files', { method: 'POST', body: form });
      const uploaded = (await response.json()) as any;
      if (!response.ok) throw new Error(uploaded.error || 'Caricamento non riuscito.');
      const next = {
        ...value,
        fileId: uploaded.id,
        fileName: uploaded.name,
        recognition: undefined,
        reviewed: false,
        reviewer: '',
        catalogId: value.fileId ? '' : value.catalogId || '',
        catalogIds: value.fileId ? [] : value.catalogIds || [],
        catalogProposal: undefined,
        catalogMatchingDismissed: false,
      };
      for (const key of Object.keys(labels)) next[key] = key === 'category' ? 'Altro' : '';
      onChange(next);
      await analyze(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione non riuscita.');
      setPhase('');
      if (propagate) throw e;
    } finally {
      running.current = false;
      onBusy(propagate);
    }
  }
  async function retry() {
    if (running.current || !value.fileId) return;
    if (
      !window.confirm(
        'Rileggere il documento e sostituire i dati proposti? Le modifiche manuali ai campi estratti saranno sostituite.',
      )
    )
      return;
    running.current = true;
    onBusy(true);
    setError('');
    try {
      await analyze(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analisi non riuscita.');
      setPhase('');
    } finally {
      running.current = false;
      onBusy(false);
    }
  }
  function field(key: FieldKey) {
    const finding = recognition?.fields[key];
    const changed =
      !!finding && (value[key] || '') !== (finding.value || (key === 'category' ? 'Altro' : ''));
    return (
      <label className="field" key={key}>
        <span>
          {labels[key]}
          {key === 'title' ? ' *' : ''}
        </span>
        {key === 'category' ? (
          <select
            value={value.category || 'Altro'}
            onChange={e => onChange({ ...value, category: e.target.value })}
            style={{ padding: 12, border: '1px solid #c8d3e2', borderRadius: 7, background: 'white' }}
          >
            {categories.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        ) : key === 'publicDescription' ? (
          <textarea
            rows={2}
            maxLength={500}
            value={value[key] || ''}
            onChange={e => onChange({ ...value, [key]: e.target.value })}
          />
        ) : (
          <input
            type={key === 'issued' || key === 'expires' ? 'date' : 'text'}
            required={key === 'title'}
            maxLength={limits[key]}
            value={value[key] || ''}
            onChange={e => onChange({ ...value, [key]: e.target.value })}
          />
        )}
        {finding && (
          <small style={{ color: !changed && finding.confidence !== 'alta' ? '#835513' : undefined }}>
            {changed
              ? 'Modificato dal responsabile'
              : finding.value
                ? finding.confidence === 'alta'
                  ? 'Proposta automatica · da confermare'
                  : 'Dato incerto · controlla l’originale'
                : 'Non rilevato · lasciato da completare'}
            {finding.page ? ' · pagina ' + finding.page : ''}
            {finding.evidence ? ' · «' + finding.evidence + '»' : ''}
          </small>
        )}
      </label>
    );
  }
  return (
    <fieldset disabled={busy && !cameraOpen} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {value.fileId && (
        <section className="document-preview">
          <h2>Anteprima del documento</h2>
          {/\.(png|jpe?g|webp)$/i.test(value.fileName || '') ? (
            <img
              src={'/api/files?id=' + encodeURIComponent(value.fileId)}
              alt="Documento da verificare"
              style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain' }}
            />
          ) : (
            <iframe
              title="Anteprima del documento"
              src={'/api/files?id=' + encodeURIComponent(value.fileId)}
              style={{
                width: '100%',
                height: 'min(65vh,650px)',
                border: '1px solid #ccd7e6',
                borderRadius: 8,
                marginTop: 12,
              }}
            />
          )}
          <a
            className="textbutton"
            href={'/api/files?id=' + encodeURIComponent(value.fileId)}
            target="_blank"
            rel="noreferrer"
          >
            Apri {value.fileName} a tutto schermo
          </a>
          <p className="smallnote">Scorri sotto l’anteprima per controllare e modificare l’anagrafica.</p>
        </section>
      )}
      {!hideSource && (
        <div className="panel" style={{ background: '#f4f7fc', padding: 18, marginTop: 18 }}>
          <h2>Carica il documento: compiliamo la scheda</h2>
          <p className="muted" style={{ margin: '10px 0' }}>
            Le foto vengono convertite in PDF prima del caricamento. Il PDF viene inviato a OpenAI per
            proporre categoria e dati. Controlla il risultato prima di salvare.
          </p>
          <label className="field">
            <span>Scegli un documento</span>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void select(file);
              }}
            />
            <small>Riconoscimento fino a 10 MB; archiviazione fino a 20 MB per file.</small>
          </label>
          <DocumentCamera
            disabled={busy && !cameraOpen}
            onSessionChange={v => {
              setCameraOpen(v);
              onBusy(v);
            }}
            onPdf={file => select(file, true)}
          />
          {value.fileId && (
            <div className="row">
              <a
                className="textbutton"
                href={'/api/files?id=' + encodeURIComponent(value.fileId)}
                target="_blank"
                rel="noreferrer"
              >
                Apri originale: {value.fileName}
              </a>
              <button type="button" className="button secondary compact" onClick={() => void retry()}>
                Rileggi documento
              </button>
            </div>
          )}
          <p role="status" aria-live="polite" className="smallnote">
            {phase ||
              (!value.fileId
                ? 'Puoi anche compilare la scheda manualmente.'
                : 'Originale caricato. La scheda viene registrata quando premi Salva.')}
          </p>
          {error && (
            <p role="alert" className="notice error" style={{ marginTop: 12, marginBottom: 0 }}>
              {error}
            </p>
          )}
        </div>
      )}
      {recognition && (
        <div className="notice" style={{ display: 'block' }}>
          <strong>
            {recognition.quality === 'illeggibile'
              ? 'Documento non leggibile'
              : recognition.quality === 'parziale'
                ? 'Lettura parziale: verifica con attenzione'
                : 'Riconoscimento completato: verifica la proposta'}
          </strong>
          <p>
            Le indicazioni di lettura non certificano autenticità o validità. I campi assenti restano vuoti.
          </p>
          {recognition.warnings.map((w, i) => (
            <p key={i}>• {w}</p>
          ))}
        </div>
      )}
      {field('title')}
      {field('category')}
      <div className="formgrid">
        {(['documentType', 'issuer', 'holder', 'vat', 'protocol', 'issued', 'expires'] as FieldKey[]).map(
          field,
        )}
      </div>
      {field('address')}
      {field('publicDescription')}
      <DocumentCatalogue value={value} onChange={onChange} />
      <label className="field">
        <span>Priorità organizzativa</span>
        <select
          style={{ padding: 12 }}
          value={value.priority || 'Prioritario'}
          onChange={e => onChange({ ...value, priority: e.target.value })}
        >
          {['Prioritario', 'Secondario', 'Opzionale'].map(x => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note interne</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={value.notes || ''}
          onChange={e => onChange({ ...value, notes: e.target.value })}
        />
      </label>
      <label className="checkrow">
        <input
          type="checkbox"
          checked={!!value.reviewed}
          onChange={e => onChange({ ...value, reviewed: e.target.checked })}
        />
        È stata effettuata una verifica umana del documento
      </label>
      {value.reviewed && (
        <label className="field">
          <span>Chi ha verificato e quando? *</span>
          <input
            required
            maxLength={200}
            value={value.reviewer || ''}
            onChange={e => onChange({ ...value, reviewer: e.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
