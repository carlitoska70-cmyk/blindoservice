'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { offlineIds, offlineSupported, removeOffline, saveOffline } from '@/lib/offline';
import {
  ChevronRight,
  Clock,
  CloudCheck,
  CloudDownload,
  ExternalLink,
  FileText,
  FolderOpen,
  Plus,
  Search,
} from 'lucide-react';
import { categories, docState, Entry } from '@/lib/product';
import { Badge, fmt, OpenEntry, Pick, SectionTitle } from './shared';

const searchable = (d: any) =>
  [d.title, d.notes, d.protocol, d.holder, d.issuer, d.documentType].join(' ').toLowerCase();

function useOfflineDocs() {
  const [ids, setIds] = useState<Set<string>>(new Set()),
    [working, setWorking] = useState(''),
    [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!offlineSupported()) return;
    offlineIds()
      .then(found => {
        setSupported(true);
        setIds(found);
      })
      .catch(() => {});
  }, []);
  async function toggle(fileId: string, title: string) {
    setWorking(fileId);
    try {
      if (ids.has(fileId)) await removeOffline(fileId);
      else await saveOffline(fileId, title);
      setIds(await offlineIds());
      toast.success(ids.has(fileId) ? 'Copia offline rimossa' : 'Disponibile offline su questo dispositivo');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWorking('');
    }
  }
  return { ids, working, supported, toggle };
}

export default function ArchiveTab({
  documents,
  query,
  onQuery,
  filter,
  onFilter,
  onOpen,
}: {
  documents: Entry[];
  query: string;
  onQuery: (query: string) => void;
  filter: string;
  onFilter: (filter: string) => void;
  onOpen: OpenEntry;
}) {
  const offline = useOfflineDocs();
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return documents.filter(
      x => (filter === 'Tutte' || x.data.category === filter) && searchable(x.data).includes(q),
    );
  }, [documents, query, filter]);
  return (
    <>
      <SectionTitle
        eyebrow="ARCHIVIO RISERVATO"
        title="Documenti"
        text="Originali, riferimenti e date da riesaminare."
      >
        <button className="button primary" onClick={() => onOpen('document')}>
          <Plus size={18} />
          Carica documenti / cartella
        </button>
      </SectionTitle>
      <div className="toolbar">
        <div className="searchbox">
          <Search size={18} />
          <input
            aria-label="Cerca un documento"
            placeholder="Titolo, protocollo o note…"
            value={query}
            onChange={e => onQuery(e.target.value)}
          />
        </div>
        <Pick value={filter} onChange={onFilter} options={['Tutte', ...categories]} />
      </div>
      <div className="documentgrid">
        {visible.map(x => {
          const state = docState(x.data);
          return (
            <article className="documentcard" key={x.id}>
              <div className="sectionhead">
                <span className="fileicon">
                  <FileText />
                </span>
                <Badge tone={state.tone}>{state.text}</Badge>
              </div>
              <p className="eyebrow">{x.data.category}</p>
              <h3>{x.data.title}</h3>
              <p className="muted">{x.data.protocol || 'Protocollo non indicato'}</p>
              <div className="docdate">
                <Clock size={15} />
                Data da riesaminare: {fmt(x.data.expires)}
              </div>
              <div className="cardactions">
                <button className="textbutton" onClick={() => onOpen('document', x)}>
                  Scheda <ChevronRight size={15} />
                </button>
                {x.data.fileId && offline.supported && (
                  <button
                    className={'textbutton offlinebutton' + (offline.ids.has(x.data.fileId) ? ' saved' : '')}
                    disabled={offline.working === x.data.fileId}
                    onClick={() => offline.toggle(x.data.fileId, x.data.title)}
                    title="Copia sul dispositivo, consultabile senza rete. Viene cancellata all’uscita."
                  >
                    {offline.ids.has(x.data.fileId) ? (
                      <>
                        <CloudCheck size={15} /> Offline
                      </>
                    ) : (
                      <>
                        <CloudDownload size={15} /> Salva offline
                      </>
                    )}
                  </button>
                )}
                {x.data.fileId ? (
                  <a
                    href={'/api/files?id=' + x.data.fileId}
                    target="_blank"
                    rel="noreferrer"
                    className="button secondary compact"
                  >
                    Apri originale <ExternalLink size={14} />
                  </a>
                ) : (
                  <Badge>Allegato assente</Badge>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {documents.length > 0 && !visible.length && (
        <div className="panel empty">
          <Search />
          <h2>Nessun documento corrisponde</h2>
          <p>Modifica la ricerca o scegli un’altra categoria.</p>
          <button
            className="button secondary"
            onClick={() => {
              onQuery('');
              onFilter('Tutte');
            }}
          >
            Mostra tutti
          </button>
        </div>
      )}
      {!documents.length && (
        <div className="panel empty">
          <FolderOpen />
          <h2>Il tuo archivio parte dagli originali</h2>
          <p>Carica una cartella, PDF o fotografie: il sistema propone categoria e dati da confermare.</p>
          <button className="button secondary" onClick={() => onOpen('document')}>
            Carica il primo documento
          </button>
        </div>
      )}
      <p className="smallnote">
        “Verifica annotata” indica una verifica dichiarata dall’utente, non una validazione automatica.
        Nessuna data inserita non significa validità illimitata.
      </p>
    </>
  );
}
