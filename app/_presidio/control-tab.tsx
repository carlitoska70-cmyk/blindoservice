'use client';
import { useState } from 'react';
import {
  Clock,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  Mic,
  Plus,
  Printer,
  Save,
  ScanLine,
  Square,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { docState, Entry, guidance, Profile } from '@/lib/product';
import AiPanel from '../ai-panel';
import type { Recorder } from './use-recorder';
import { Action, Badge, download, Field, fmt, OpenEntry, Pick, SectionTitle, time } from './shared';

const clock = (s: number) =>
  Math.floor(s / 60)
    .toString()
    .padStart(2, '0') +
  ':' +
  (s % 60).toString().padStart(2, '0');

const secondsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));

function exportReport(profile: Profile, current: Entry, events: Entry[]) {
  const text = [
    'PRESIDIO — FASCICOLO DEL CONTROLLO',
    profile.name,
    `Ente: ${current.data.authority}`,
    `Oggetto: ${current.data.scope}`,
    `Interlocutori dichiarati: ${current.data.officers || 'Non annotati'}`,
    `Riferimento: ${current.data.reference || 'Non indicato'}`,
    `Inizio: ${current.data.started}`,
    `Stato: ${current.data.status}`,
    `Esito annotato: ${current.data.outcome || 'Non annotato'}`,
    '',
    'CRONOLOGIA — ANNOTAZIONI DELL’UTENTE',
    ...events.map(
      x =>
        `${x.created} | ${x.data.speaker} | ${x.data.tag}\n${x.data.text}${x.data.fileId ? '\nAllegato riservato: ' + location.origin + '/api/files?id=' + x.data.fileId : ''}`,
    ),
    '',
    'Questo fascicolo raccoglie annotazioni e allegati: non è un verbale dell’autorità, una perizia né un accertamento di responsabilità. Gli allegati originali vanno scaricati separatamente.',
  ].join('\n\n');
  download(text, 'fascicolo-' + current.id.slice(0, 8) + '.txt', 'text/plain;charset=utf-8');
}

// Lives in the parent so a draft note survives switching tabs (inactive tabs unmount).
export function useNoteDraft() {
  const [question, setQuestion] = useState(''),
    [speaker, setSpeaker] = useState('Controllore 1'),
    [tag, setTag] = useState('Richiesta');
  return { question, setQuestion, speaker, setSpeaker, tag, setTag };
}

export default function ControlTab({
  profile,
  records,
  documents,
  inspections,
  selected,
  onSelect,
  recorder,
  draft,
  busy,
  aiReady,
  action,
  onOpen,
  onTab,
  onRefresh,
}: {
  profile: Profile;
  records: Entry[];
  documents: Entry[];
  inspections: Entry[];
  selected: string;
  onSelect: (id: string) => void;
  recorder: Recorder;
  draft: ReturnType<typeof useNoteDraft>;
  busy: boolean;
  aiReady: boolean;
  action: Action;
  onOpen: OpenEntry;
  onTab: (tab: string) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { question, setQuestion, speaker, setSpeaker, tag, setTag } = draft;
  const { rec, pending } = recorder;
  const current = inspections.find(x => x.id === selected);
  const events = records
    .filter(x => x.kind === 'event' && x.data.inspectionId === selected)
    .sort((a, b) => a.created.localeCompare(b.created));
  const suggestion = guidance(question, documents);
  const open = current?.data.status === 'aperto';

  async function addEvent() {
    if (!current || !question.trim()) return;
    const result = await action(
      {
        action: 'create',
        kind: 'event',
        data: {
          inspectionId: current.id,
          speaker,
          text: question,
          tag,
          offset: secondsSince(current.data.started),
        },
      },
      'Annotazione aggiunta',
    );
    if (result) setQuestion('');
  }

  return (
    <>
      <SectionTitle
        eyebrow="ASSISTENZA AL CONTROLLO"
        title="La postazione"
        text="Annota con precisione. Richiama i documenti. Mantieni il contesto."
      >
        <div className="row">
          <button className="button secondary" onClick={() => onTab('room')}>
            <ScanLine size={18} />
            QR di accesso
          </button>
          <button className="button primary" disabled={pending} onClick={() => onOpen('inspection')}>
            <Plus size={18} />
            Nuovo controllo
          </button>
        </div>
      </SectionTitle>
      {inspections.length > 0 && (
        <div className="inspectionpicker">
          <span>Fascicolo</span>
          <Select value={selected || undefined} disabled={pending} onValueChange={onSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Scegli un controllo" />
            </SelectTrigger>
            <SelectContent>
              {inspections.map(x => (
                <SelectItem key={x.id} value={x.id}>
                  {fmt(x.created)} · {x.data.authority} · {x.data.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!current ? (
        <div className="panel empty">
          <ScanLine />
          <h2>{inspections.length ? 'Scegli il fascicolo da aprire' : 'Nessun controllo registrato'}</h2>
          <p>
            Il modulo raccoglie ente, oggetto, interlocutori e riferimenti. Può compilarlo il responsabile
            anche se i controllori non usano il QR.
          </p>
          <button className="button primary" onClick={() => onOpen('inspection')}>
            Registra l’inizio del controllo
          </button>
        </div>
      ) : (
        <>
          <div className="sessionbar">
            <div>
              <Badge tone={open ? 'blue' : 'gray'}>{open ? 'Fascicolo aperto' : 'Fascicolo concluso'}</Badge>
              <h2>{current.data.authority}</h2>
              <p>
                {current.data.scope} · {fmt(current.data.started)}
              </p>
            </div>
            <div className="row">
              <button className="button secondary" onClick={() => exportReport(profile, current, events)}>
                <Download size={16} />
                Esporta cronologia
              </button>
              <a
                className="button secondary"
                href={'/fascicolo?id=' + encodeURIComponent(current.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Printer size={16} />
                PDF
              </a>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => onOpen('inspection', current)}
              >
                Dati ed esito
              </button>
            </div>
          </div>
          <div className="controlgrid">
            <section className="panel">
              <div className="sectionhead">
                <h2>Richiesta e risposta</h2>
                <Badge>Supporto guidato</Badge>
              </div>
              <p className="muted">
                Formule operative e ricerca per categoria. Queste frasi sono modelli organizzativi; non sono
                risposte generate dall’ascolto.
              </p>
              <Field label="Che cosa è stato chiesto o detto?">
                <textarea
                  rows={4}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Es. Ci mostri la documentazione relativa all’agibilità…"
                  maxLength={4000}
                  disabled={!open}
                />
              </Field>
              <div className="formgrid">
                <Field label="Interlocutore (assegnazione manuale)">
                  <input value={speaker} onChange={e => setSpeaker(e.target.value)} maxLength={200} />
                </Field>
                <Field label="Tipo di annotazione">
                  <Pick
                    value={tag}
                    onChange={setTag}
                    options={['Richiesta', 'Nota', 'Da verificare', 'Documento esibito']}
                  />
                </Field>
              </div>
              {question.trim() && (
                <div className="responsecard">
                  <p className="eyebrow">FORMULA DA ADATTARE</p>
                  <blockquote>{suggestion.response}</blockquote>
                  <p>{suggestion.note}</p>
                </div>
              )}
              <button
                className="button primary full"
                disabled={busy || !question.trim() || !open}
                onClick={addEvent}
              >
                <Plus size={17} />
                Aggiungi alla cronologia
              </button>
              <div className="linkedfiles">
                <h3>Documenti richiamati {suggestion.category && <small>· {suggestion.category}</small>}</h3>
                {question.trim() ? (
                  suggestion.docs.length ? (
                    suggestion.docs.map(x => (
                      <div className="linkedfile" key={x.id}>
                        <FileText size={22} />
                        <span>
                          {x.data.title}
                          <small>{docState(x.data).text}</small>
                        </span>
                        {x.data.fileId ? (
                          <a
                            href={'/api/files?id=' + x.data.fileId}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={'Apri ' + x.data.title}
                          >
                            <ExternalLink size={18} />
                          </a>
                        ) : (
                          <span className="muted">Solo scheda</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      Nessun documento corrispondente. Non dichiararlo disponibile finché non è stato
                      individuato.
                    </p>
                  )
                ) : (
                  <p className="muted">Scrivi una richiesta per richiamare la categoria pertinente.</p>
                )}
              </div>
            </section>
            <section className="panel timelinepanel">
              <div className="sectionhead">
                <h2>Cronologia</h2>
                <Badge>
                  {events.length} {events.length === 1 ? 'annotazione' : 'annotazioni'}
                </Badge>
              </div>
              <p className="smallnote">
                Orari di archiviazione · fuso Europe/Rome. Le note non sono il verbale dell’autorità.
              </p>
              <div className="timeline">
                {events.map(x => (
                  <article key={x.id}>
                    <div className="timelinehead">
                      <time>{time(x.created)}</time>
                      <Badge tone={x.data.tag === 'Da verificare' ? 'amber' : 'gray'}>{x.data.tag}</Badge>
                    </div>
                    <strong>{x.data.speaker || 'Interlocutore non indicato'}</strong>
                    <p>{x.data.text}</p>
                    {x.data.fileId && (
                      <>
                        <audio controls preload="none" src={'/api/files?id=' + x.data.fileId} />
                        <a
                          className="textbutton"
                          href={'/api/files?id=' + x.data.fileId}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Apri audio <ExternalLink size={14} />
                        </a>
                      </>
                    )}
                  </article>
                ))}
                {!events.length && (
                  <div className="empty">
                    <Clock />
                    <p>Le annotazioni compariranno qui in ordine cronologico.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
          <section className="panel audiopanel">
            <div>
              <div className="sectionhead">
                <h2>
                  <Headphones size={20} /> Audio del controllo
                </h2>
                <Badge tone={rec ? 'red' : 'gray'}>
                  {rec ? 'Registrazione in corso' : 'Attivazione manuale'}
                </Badge>
              </div>
              <p className="muted">
                Registra dal microfono di questo dispositivo mentre partecipi al colloquio. Audio riservato al
                titolare; il portale dei controllori non vi accede. La proprietà del locale e la compilazione
                del QR non sostituiscono la verifica delle condizioni di registrazione e trattamento.
              </p>
              <label className="checkrow">
                <Checkbox
                  checked={recorder.ready}
                  onCheckedChange={v => recorder.setReady(v === true)}
                  disabled={rec}
                />
                <span>
                  Partecipo al colloquio e limito la registrazione a questa sessione per documentare il
                  controllo e tutelare i miei diritti.
                </span>
              </label>
              <p className="smallnote">
                Il browser deve restare aperto. Nessuna registrazione in background garantita. Al termine il
                segmento viene archiviato automaticamente. Se l’invio fallisce, conserva la copia locale prima
                di uscire.
              </p>
            </div>
            <div className="audioactions">
              {rec ? (
                <>
                  <strong className="timer">{clock(recorder.elapsed)}</strong>
                  <button className="button danger" onClick={recorder.stop}>
                    <Square size={16} />
                    Ferma
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  disabled={!recorder.ready || !!recorder.audio || busy || !open}
                  onClick={() => recorder.start(current)}
                >
                  <Mic size={17} />
                  Avvia registrazione
                </button>
              )}
              {recorder.audio && (
                <>
                  <audio controls src={recorder.audioUrl} />
                  <button className="button primary" disabled={busy} onClick={() => recorder.save(current)}>
                    <Save size={16} />
                    Archivia audio
                  </button>
                  <a className="textbutton" href={recorder.audioUrl} download={recorder.audio.name}>
                    Scarica copia locale
                  </a>
                </>
              )}
              {!pending && open && (
                <label className="uploadlink">
                  Allega audio esistente
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) recorder.attach(f, current);
                    }}
                  />
                </label>
              )}
            </div>
          </section>
          <AiPanel records={records} inspectionId={current.id} ready={aiReady} onRefresh={onRefresh} />
        </>
      )}
    </>
  );
}
