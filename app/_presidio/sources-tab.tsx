'use client';
import { Fragment } from 'react';
import { ArrowUpRight, BookOpen, ChevronRight } from 'lucide-react';
import { sources } from '@/lib/product';
import CatalogueSources from '../catalogue-sources';
import NewsPanel from './news-panel';
import { Badge, SectionTitle } from './shared';

const roadmap: [string, string, string, string][] = [
  [
    'Archivio e identità',
    'Disponibile',
    'blue',
    'Allegati riservati, metadati, date, confronti di partita IVA e sede, attività assegnate e fascicoli esportabili.',
  ],
  [
    'QR per i controllori',
    'Disponibile',
    'blue',
    'Modulo separato, dati dichiarati obbligatori per l’accesso al portale, autorizzazione del titolare, documenti selezionati, ricerche e cronologia. Rimane disponibile l’esibizione assistita.',
  ],
  [
    'Catalogo documentale e fonti',
    'Disponibile',
    'gray',
    'Ricerca per area, abbinamenti con gli originali, applicabilità annotata e riferimenti ufficiali. Il monitoraggio normativo continuo e la verifica legale automatica non sono attivi.',
  ],
  [
    'Assistente durante il controllo',
    'Da integrare e validare',
    'gray',
    'Trascrizione con tempi e interlocutori, domande estratte, risposta breve fondata su fonti e documenti. Identità assegnate manualmente, senza riconoscimento biometrico.',
  ],
  [
    'Passaggi da esaminare',
    'Da validare con il legale',
    'gray',
    'Distinguere fatto, dichiarazione, contraddizione e ipotesi. Citare il passaggio e il contesto, senza attribuire automaticamente reati né valutare menzogne dalla voce.',
  ],
  [
    'Conservazione e diffusione',
    'Prima dell’uso su larga scala',
    'gray',
    'Ruoli, separazione tra imprese, tempi di conservazione, cancellazione, backup, gestione incidenti e valutazione d’impatto ove necessaria. Nessuna diffusione pubblica degli audio.',
  ],
];
const ruleflow = [
  'Fonte ufficiale',
  'Versione e periodo',
  'Territorio e attività',
  'Dati dell’impresa',
  'Verifica motivata',
];

export default function SourcesTab({
  canRefresh = false,
  onTask = () => {},
}: {
  canRefresh?: boolean;
  onTask?: (title: string, notes: string) => void;
}) {
  return (
    <>
      <NewsPanel canRefresh={canRefresh} onTask={onTask} />
      <CatalogueSources />
      <SectionTitle
        eyebrow="FONTI E SVILUPPO"
        title="La norma, nel suo contesto."
        text="Territorio, periodo, attività e documento devono coincidere."
      >
        <Badge tone="amber">Monitoraggio automatico non attivo</Badge>
      </SectionTitle>
      <div className="notice">
        <BookOpen size={22} />
        <div>
          <strong>Questa versione è un archivio operativo.</strong>
          <p>
            I collegamenti seguenti sono punti di consultazione. Non costituiscono una banca dati esaustiva né
            una verifica legale aggiornata della tua impresa.
          </p>
        </div>
      </div>
      <div className="sourcegrid">
        {sources.map(x => (
          <a className="panel sourcecard" key={x.title} href={x.url} target="_blank" rel="noreferrer">
            <div className="sectionhead">
              <p className="eyebrow">{x.scope}</p>
              <ArrowUpRight size={18} />
            </div>
            <h3>{x.title}</h3>
            <p>{x.use}</p>
          </a>
        ))}
      </div>
      <section className="panel projectpanel">
        <p className="eyebrow">PROGETTO COMPLETO</p>
        <h2>Una tutela costruita su elementi verificabili</h2>
        <div className="projectgrid">
          {roadmap.map(([title, status, tone, text], i) => (
            <article key={title}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <Badge tone={tone}>{status}</Badge>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Come dovrà funzionare il motore normativo</h2>
        <div className="ruleflow">
          {ruleflow.map((step, i) => (
            <Fragment key={step}>
              {i > 0 && <ChevronRight />}
              <span>{step}</span>
            </Fragment>
          ))}
        </div>
        <p className="muted">
          Ogni rilievo dovrà indicare articolo, testo pertinente, data dell’ultima verifica, fatti aziendali
          utilizzati, condizioni di applicabilità e azione proposta. In assenza di elementi sufficienti: “Non
          determinabile”.
        </p>
        <p className="smallnote">
          Un nuovo articolo online non diventa automaticamente un nuovo obbligo. Una proposta di legge resta
          distinta da una norma vigente. Le interpretazioni e le sentenze vanno distinte dal testo normativo.
        </p>
      </section>
    </>
  );
}
