'use client';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  LockKeyhole,
  Plus,
  ScanLine,
} from 'lucide-react';
import { categories, checks, dayDiff, Entry, Profile } from '@/lib/product';
import { Badge, fmt, OpenEntry } from './shared';

export default function OverviewTab({
  profile,
  documents,
  inspections,
  tasks,
  onOpen,
  onTab,
  onFilter,
  onInspection,
}: {
  profile: Profile;
  documents: Entry[];
  inspections: Entry[];
  tasks: Entry[];
  onOpen: OpenEntry;
  onTab: (tab: string) => void;
  onFilter: (category: string) => void;
  onInspection: (id: string) => void;
}) {
  const findings = checks(profile, documents);
  const toReview = documents.filter(x => {
    const d = dayDiff(x.data.expires);
    return d !== null && d <= 30;
  }).length;
  return (
    <>
      <div className="pageheading">
        <div>
          <p className="eyebrow">PRIMA, DURANTE E DOPO UN CONTROLLO</p>
          <h1>
            Ogni documento.
            <br />
            <span>Al momento giusto.</span>
          </h1>
        </div>
        <button className="button primary" onClick={() => onOpen('inspection')}>
          <ScanLine size={18} />
          Avvia un controllo
        </button>
      </div>
      <section className="panel">
        <div className="sectionhead">
          <div>
            <h2>Prepara i documenti per il controllo</h2>
            <p className="muted">
              Valuta le voci pertinenti, abbina gli originali e crea un’azione per ciò che devi reperire.
            </p>
          </div>
          <button type="button" className="button secondary" onClick={() => onTab('catalogue')}>
            Apri catalogo
          </button>
        </div>
      </section>
      <div className="metrics">
        <div>
          <FolderOpen />
          <strong>{documents.length}</strong>
          <span>documenti archiviati</span>
        </div>
        <div>
          <CalendarDays />
          <strong>{toReview}</strong>
          <span>date da riesaminare</span>
        </div>
        <div>
          <ScanLine />
          <strong>{inspections.filter(x => x.data.status === 'aperto').length}</strong>
          <span>controlli aperti</span>
        </div>
        <div>
          <ClipboardList />
          <strong>{tasks.filter(x => !x.data.done).length}</strong>
          <span>azioni da completare</span>
        </div>
      </div>
      <div className="twocol">
        <section className="panel">
          <div className="sectionhead">
            <h2>Da portare all’attenzione</h2>
            <Badge tone="amber">
              {findings.length} {findings.length === 1 ? 'verifica' : 'verifiche'}
            </Badge>
          </div>
          <p className="muted">Controlli sui dati inseriti. Non certificano la conformità dell’impresa.</p>
          <div className="findings">
            {findings.length ? (
              findings.map((x, i) => (
                <button key={i} className="finding" onClick={() => onTab(x.target)}>
                  <span className={'findingicon ' + x.tone}>
                    <AlertTriangle size={18} />
                  </span>
                  <span>
                    <strong>{x.title}</strong>
                    <small>{x.detail}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))
            ) : (
              <div className="empty">
                <Check />
                <h3>Nessuna anomalia nei confronti disponibili</h3>
                <p>Il controllo copre solo i campi censiti. La validità giuridica richiede verifica.</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel darkpanel">
          <p className="eyebrow">LA TUA POSTAZIONE DI ASSISTENZA</p>
          <h2>
            Quando arriva
            <br />
            un controllo,
            <br />
            apri il fascicolo.
          </h2>
          <p>
            Richieste, documenti e annotazioni nella stessa schermata. Una cronologia ordinata da rileggere
            con il professionista.
          </p>
          <button className="button light" onClick={() => onTab('control')}>
            Apri la postazione <ArrowUpRight size={17} />
          </button>
          <div className="darkfoot">
            <LockKeyhole size={15} /> L’archivio resta riservato.
          </div>
        </section>
      </div>
      <section className="panel recentinspections">
        <div className="sectionhead">
          <h2>Ultimi controlli</h2>
          <button className="textbutton" onClick={() => onTab('control')}>
            Storico completo
          </button>
        </div>
        {inspections.slice(0, 5).map(x => (
          <button className="finding" key={x.id} onClick={() => onInspection(x.id)}>
            <ScanLine size={20} />
            <span>
              <strong>{x.data.authority}</strong>
              <small>
                {fmt(x.created)} · {x.data.scope}
              </small>
            </span>
            <Badge>{x.data.status}</Badge>
          </button>
        ))}
        {!inspections.length && (
          <p className="muted">I controlli manuali e le sessioni QR autorizzate compariranno qui.</p>
        )}
      </section>
      <div className="lowergrid">
        <section className="panel">
          <div className="sectionhead">
            <h2>Costruisci il tuo fascicolo</h2>
            <button className="textbutton" onClick={() => onOpen('document')}>
              Aggiungi <Plus size={16} />
            </button>
          </div>
          <div className="categorygrid">
            {categories.slice(0, 6).map(c => (
              <button key={c} onClick={() => onFilter(c)}>
                <FolderOpen size={20} />
                <span>{c}</span>
                <strong>{documents.filter(x => x.data.category === c).length}</strong>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Il prossimo passo concreto</h2>
          <p className="muted">
            Carica i documenti originali, completa intestazione e sede, poi assegna le verifiche a un
            referente.
          </p>
          <button className="button secondary" onClick={() => onOpen('task')}>
            Crea un’azione <Plus size={16} />
          </button>
          <p className="smallnote">
            Notifiche esterne e sorveglianza automatica delle norme non sono ancora attive.
          </p>
        </section>
      </div>
    </>
  );
}
