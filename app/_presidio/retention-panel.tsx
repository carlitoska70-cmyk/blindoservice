'use client';
// Data retention in the owner's views: when the personal data of an inspection go away,
// «Procedimento in corso» to keep them, and the listening log of the audio files.
import { useState } from 'react';
import { ChevronRight, Gavel, Headphones, Trash2 } from 'lucide-react';
import type { Entry } from '@/lib/product';
import type { InspectionData } from '@/lib/schemas';
import {
  CHILD_KINDS,
  CONTROL_DAYS,
  RELEASE_DAYS,
  inspectionDue,
  retentionPlan,
  type InspectionRetention,
  type RetentionState,
} from '@/lib/retention';
import { Action, Badge, Field, fmt, time } from './shared';
import './retention.css';

type Inspection = Entry<InspectionData & InspectionRetention>;
const children = (records: Entry[], id: string) =>
  records.filter(r => (CHILD_KINDS as readonly string[]).includes(r.kind) && r.data?.inspectionId === id);

/** Bar under the inspection header: deletion date, «Procedimento in corso», deleted data. */
export function InspectionRetentionBar({
  inspection,
  records,
  busy,
  action,
}: {
  inspection: Inspection;
  records: Entry[];
  busy: boolean;
  action: Action;
}) {
  const [form, setForm] = useState<{ dal: string; riferimento: string; nota: string } | null>(null);
  const d = inspection.data;
  if (d.anonimizzato)
    return (
      <div className="retentionbar done">
        <Trash2 size={17} />
        <p>
          <strong>Dati personali cancellati il {fmt(d.anonimizzato)}.</strong> Sono passati {CONTROL_DAYS}{' '}
          giorni: sessione del portale, nomi degli agenti, annotazioni, audio, trascrizioni e rapporti non ci
          sono più. Restano ente, oggetto, date ed esito.
        </p>
      </div>
    );
  const due = inspectionDue(inspection, children(records, inspection.id));
  const set = (open: boolean, hold?: typeof form) =>
    action(
      { action: 'procedimento', id: inspection.id, version: inspection.updated, open, hold },
      open ? 'Procedimento in corso: i dati restano' : 'Procedimento chiuso',
    ).then(ok => ok && setForm(null));
  return (
    <div className={'retentionbar' + (d.procedimento && !d.procedimentoChiuso ? ' held' : '')}>
      <Gavel size={17} />
      {d.procedimento && !d.procedimentoChiuso ? (
        <p>
          <strong>Procedimento in corso</strong>
          {d.procedimento.riferimento ? ' · ' + d.procedimento.riferimento : ''}
          {d.procedimento.dal ? ' dal ' + fmt(d.procedimento.dal) : ''}. Audio, trascrizioni e dati del
          portale restano finché non lo segni chiuso.
        </p>
      ) : (
        <p>
          I dati personali di questo controllo (sessione del portale, nomi degli agenti, annotazioni, audio,
          trascrizioni e rapporti) si cancellano da soli dal <strong>{fmt(due.due!)}</strong>
          {d.procedimentoChiuso
            ? `, ${RELEASE_DAYS} giorni dopo la chiusura del procedimento.`
            : `, ${CONTROL_DAYS} giorni dopo l’ultima attività. Se arriva un verbale o una contestazione, segna il procedimento.`}
        </p>
      )}
      <div className="row">
        {d.procedimento && !d.procedimentoChiuso ? (
          <button
            className="button secondary compact"
            disabled={busy}
            onClick={() =>
              window.confirm(
                `Il procedimento è chiuso (pagato, archiviato o deciso)? I dati personali si cancelleranno tra ${RELEASE_DAYS} giorni.`,
              ) && set(false)
            }
          >
            Procedimento chiuso
          </button>
        ) : (
          !form && (
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => setForm({ dal: '', riferimento: '', nota: '' })}
            >
              Procedimento in corso
            </button>
          )
        )}
      </div>
      {form && (
        <form
          className="retentionform"
          onSubmit={e => {
            e.preventDefault();
            void set(true, form);
          }}
        >
          <div className="formgrid">
            <Field label="Data del verbale o della contestazione">
              <input type="date" value={form.dal} onChange={e => setForm({ ...form, dal: e.target.value })} />
            </Field>
            <Field label="Riferimento">
              <input
                maxLength={200}
                placeholder="Es. verbale n. 123/2026"
                value={form.riferimento}
                onChange={e => setForm({ ...form, riferimento: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Nota (facoltativa)">
            <input
              maxLength={1000}
              placeholder="Es. ricorso affidato all’avv. …"
              value={form.nota}
              onChange={e => setForm({ ...form, nota: e.target.value })}
            />
          </Field>
          <div className="row">
            <button className="button primary compact" disabled={busy}>
              Tieni i dati
            </button>
            <button type="button" className="textbutton" onClick={() => setForm(null)}>
              Annulla
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** «Ascoltato N volte · ultimo …» next to an audio file (owner only). */
export function Listenings({ records, fileId }: { records: Entry[]; fileId: string }) {
  const rows = records.filter(r => r.kind === 'ascolto' && r.data?.fileId === fileId);
  if (!rows.length) return null;
  const last = rows.reduce((a, b) => (a.created > b.created ? a : b));
  return (
    <small className="listenings">
      <Headphones size={13} /> Aperto {rows.length} {rows.length === 1 ? 'volta' : 'volte'} · ultimo{' '}
      {fmt(last.created)} {time(last.created)}
    </small>
  );
}

/** Overview: inspections whose personal data go within 14 days, and the last automatic deletion. */
export function RetentionNotice({
  inspections,
  records,
  onInspection,
}: {
  inspections: Inspection[];
  records: Entry[];
  onInspection: (id: string) => void;
}) {
  const plan = retentionPlan({
    now: new Date(),
    inspections,
    children: records.filter(r => (CHILD_KINDS as readonly string[]).includes(r.kind)),
    visits: [],
  });
  const state = records.find(r => r.kind === 'retention')?.data as RetentionState | undefined;
  const lastDone = state?.history?.[0];
  if (!plan.warn.length && !plan.purge.length && !lastDone) return null;
  const soon = [...plan.purge, ...plan.warn];
  return (
    <section className="panel retentionnotice">
      <div className="sectionhead">
        <h2>Cancellazione automatica dei dati dei controlli</h2>
        <Badge tone={soon.length ? 'amber' : 'gray'}>{CONTROL_DAYS} giorni</Badge>
      </div>
      {soon.length > 0 && (
        <>
          <p className="muted">
            Questi controlli perdono a breve audio, trascrizioni e dati degli agenti. Se è arrivato un verbale
            o una contestazione, apri il fascicolo e segna «Procedimento in corso».
          </p>
          <div className="findings">
            {soon.map(p => {
              const x = inspections.find(i => i.id === p.id)!;
              return (
                <button key={p.id} className="finding" onClick={() => onInspection(p.id)}>
                  <span className="findingicon amber">
                    <Trash2 size={18} />
                  </span>
                  <span>
                    <strong>{x.data.authority}</strong>
                    <small>
                      {fmt(x.data.started || x.created)} · cancellazione dal {fmt(p.due)}
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {lastDone && (
        <p className="smallnote">
          Ultima cancellazione il {fmt(lastDone.at)}: {lastDone.controlli} controlli, {lastDone.sessioni}{' '}
          sessioni del portale, {lastDone.file} file, {lastDone.documenti} documenti del personale.
        </p>
      )}
    </section>
  );
}
