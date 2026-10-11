'use client';
import { useState } from 'react';
import { catalogLinks, catalogueMatches, normalized } from '@/lib/catalogue-matching';
export default function ExistingDocuments({ item, records, busy, onLinkMany, onClose }: any) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [limit, setLimit] = useState(30),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  const documents = records.filter(
    (r: any) => r.kind === 'document' && r.data.fileId && !catalogLinks(r.data).includes(item.id),
  );
  const matches = documents
    .filter((r: any) =>
      normalized([r.data.title, r.data.fileName, r.data.protocol, r.data.holder].join(' ')).includes(
        normalized(query),
      ),
    )
    .map((doc: any) => ({ doc, score: catalogueMatches(doc.data, [item])[0]?.score || 0 }))
    .sort((a: any, b: any) => b.score - a.score);
  function toggle(id: string) {
    setSelected(old => (old.includes(id) ? old.filter(x => x !== id) : [...old, id].slice(0, 100)));
  }
  async function save() {
    setSaving(true);
    setMessage('Abbinamento dei documenti selezionati…');
    try {
      const chosen = documents.filter((d: any) => selected.includes(d.id));
      const result = await onLinkMany(item, chosen);
      const good = new Set<string>(result.successIds || []);
      setSelected(old => old.filter(id => !good.has(id)));
      setMessage(
        `${good.size} documenti abbinati.` +
          (result.failures?.length
            ? ' Da riprovare: ' + result.failures.map((f: any) => f.title + ' — ' + f.error).join('; ')
            : ''),
      );
    } catch (e) {
      setMessage(
        (e as Error).message || 'Operazione interrotta. Gli abbinamenti salvati restano disponibili.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="catalog-picker" aria-label={'Abbina documenti a ' + item.title}>
      <h3>Scegli uno o più documenti dall’archivio</h3>
      <p className="muted">
        Ogni file resta unico; puoi collegare più originali alla stessa voce. Fino a 100 selezioni per
        operazione.
      </p>
      <fieldset disabled={busy || saving} style={{ border: 0, padding: 0 }}>
        <label className="field" style={{ marginTop: 16 }}>
          <span>Cerca titolo, nome file, intestatario o protocollo</span>
          <input
            type="search"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setLimit(30);
            }}
            autoFocus
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="textbutton"
            onClick={() =>
              setSelected(old =>
                [...new Set([...old, ...matches.slice(0, limit).map((x: any) => x.doc.id)])].slice(0, 100),
              )
            }
          >
            Seleziona quelli visibili
          </button>
          <button type="button" className="textbutton" onClick={() => setSelected([])}>
            Deseleziona tutti
          </button>
          <span>{selected.length} selezionati</span>
        </div>
        <div className="catalog-choices">
          {matches.slice(0, limit).map(({ doc, score }: any) => (
            <label className="catalog-choice" key={doc.id}>
              <input
                type="checkbox"
                checked={selected.includes(doc.id)}
                disabled={!selected.includes(doc.id) && selected.length >= 100}
                onChange={() => toggle(doc.id)}
              />
              <span>
                <strong>{doc.data.title}</strong>
                <small>
                  {doc.data.fileName}
                  {score >= 90 ? ' · possibile corrispondenza' : ''}
                </small>
              </span>
              <a
                href={'/api/files?id=' + encodeURIComponent(doc.data.fileId)}
                target="_blank"
                rel="noreferrer"
              >
                Apri originale
              </a>
            </label>
          ))}
        </div>
        {!matches.length && <p className="muted">Nessun originale da abbinare con questi filtri.</p>}
        {matches.length > limit && (
          <button type="button" className="textbutton" onClick={() => setLimit(limit + 30)}>
            Mostra altri
          </button>
        )}
        <div className="row">
          <button
            type="button"
            className="button primary compact"
            disabled={!selected.length}
            onClick={() => void save()}
          >
            {saving ? 'Salvataggio…' : `Abbina ${selected.length || ''} documenti selezionati`}
          </button>
          <button type="button" className="button secondary compact" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </fieldset>
      <p role="status" className="smallnote">
        {message}
      </p>
    </section>
  );
}
