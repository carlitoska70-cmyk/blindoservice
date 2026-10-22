'use client';
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock,
  Link2,
  Plus,
  Save,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Entry } from '@/lib/product';
import { DESIGNATIONS, type DocumentData, type EmployeeData } from '@/lib/schemas';
import { staffChecklist, staffDocUntil, staffEnded, staffRecordUntil, type StaffItem } from '@/lib/staff';
import { romeToday } from '@/lib/reminders';
import { Action, Badge, Field, fmt, SectionTitle } from './shared';

const emptyEmployee: EmployeeData = {
  name: '',
  role: '',
  hired: '',
  contract: '',
  endDate: '',
  extraUe: false,
  designations: [],
  medicalRequired: false,
  active: true,
  notes: '',
};
const ICON = {
  ok: <CheckCircle2 size={17} className="st-ok" />,
  in_scadenza: <Clock size={17} className="st-warn" />,
  scaduto: <CircleAlert size={17} className="st-bad" />,
  mancante: <CircleDashed size={17} className="st-miss" />,
};
const LABEL = { ok: 'Presente', in_scadenza: 'In scadenza', scaduto: 'Scaduto', mancante: 'Da caricare' };

export default function StaffTab({
  employees,
  documents,
  allDocuments = documents,
  busy,
  action,
  onNewDocument,
}: {
  employees: Entry<EmployeeData>[];
  documents: Entry<DocumentData>[];
  /** Archived documents too: a former employee's file is deleted only when nothing is left. */
  allDocuments?: Entry<DocumentData>[];
  busy: boolean;
  action: Action;
  onNewDocument: (employee: Entry<EmployeeData>, item: StaffItem) => void;
}) {
  const [editing, setEditing] = useState<Entry<EmployeeData> | null>(null),
    [form, setForm] = useState<EmployeeData | null>(null),
    [linking, setLinking] = useState<{ employee: Entry<EmployeeData>; item: StaffItem } | null>(null);
  const today = romeToday();
  const active = employees.filter(e => e.data.active);
  const former = employees.filter(e => !e.data.active);
  const unlinked = useMemo(() => documents.filter(d => !d.data.employeeId), [documents]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await action(
      editing
        ? { action: 'update', kind: 'employee', id: editing.id, version: editing.updated, data: form }
        : { action: 'create', kind: 'employee', data: form },
      editing ? 'Scheda aggiornata' : 'Dipendente aggiunto',
    );
    if (ok) setForm(null);
  }
  async function link(doc: Entry<DocumentData>) {
    if (!linking) return;
    const ok = await action(
      {
        action: 'update',
        kind: 'document',
        id: doc.id,
        version: doc.updated,
        data: { ...doc.data, employeeId: linking.employee.id },
      },
      'Documento abbinato a ' + linking.employee.data.name,
    );
    if (ok) setLinking(null);
  }

  // Former employees: the file is kept for the legal terms, then the owner deletes it document by document.
  const retention = (emp: Entry<EmployeeData>) => {
    if (!staffEnded(emp.data))
      return (
        <p className="smallnote">
          Indica la data di fine rapporto: serve a calcolare per quanto conservare i documenti.
        </p>
      );
    const mine = allDocuments.filter(d => d.data.employeeId === emp.id);
    const recordUntil = staffRecordUntil(emp.data)!;
    const purge = (body: object, what: string) =>
      window.confirm(`Cancellare definitivamente ${what}? Non si potrà recuperare.`) &&
      action({ action: 'purge', ...body }, 'Cancellato definitivamente');
    return (
      <div className="staffretention">
        <p className="smallnote">
          Conservazione dopo la fine del rapporto: documento d’identità e codice fiscale 12 mesi, permesso di
          soggiorno 6 anni, il resto 5 anni. Alla scadenza li cancelli tu da qui.
        </p>
        <ul className="stafflist">
          {mine.map(d => {
            const until = staffDocUntil(emp.data, d.data)!;
            const due = until.until <= today;
            return (
              <li key={d.id}>
                <Trash2 size={16} className={due ? 'st-bad' : 'st-miss'} />
                <span>
                  <strong>{d.data.title}</strong>
                  <small>
                    {due ? 'Cancellabile dal ' : 'Si conserva fino al '}
                    {fmt(until.until)}
                  </small>
                </span>
                {due && (
                  <button
                    className="textbutton"
                    disabled={busy}
                    onClick={() => purge({ kind: 'document', id: d.id, version: d.updated }, d.data.title)}
                  >
                    Cancella
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!mine.length &&
          (recordUntil <= today ? (
            <button
              className="textbutton"
              disabled={busy}
              onClick={() =>
                purge({ kind: 'employee', id: emp.id, version: emp.updated }, 'la scheda di ' + emp.data.name)
              }
            >
              <Trash2 size={15} /> Cancella la scheda
            </button>
          ) : (
            <p className="smallnote">La scheda si conserva fino al {fmt(recordUntil)}.</p>
          ))}
      </div>
    );
  };

  const card = (emp: Entry<EmployeeData>) => {
    // The checklist of what to collect is for current employees only.
    const items = emp.data.active ? staffChecklist(emp, documents, today) : [];
    const done = items.filter(i => i.status === 'ok').length;
    return (
      <article className="panel staffcard" key={emp.id}>
        <div className="sectionhead">
          <div className="staffwho">
            <UserRound size={20} />
            <span>
              <strong>{emp.data.name}</strong>
              <small>
                {[emp.data.role, emp.data.contract, emp.data.endDate && 'fino al ' + fmt(emp.data.endDate)]
                  .filter(Boolean)
                  .join(' · ') || 'Mansione da indicare'}
              </small>
            </span>
          </div>
          <span className="row">
            {emp.data.active && (
              <Badge tone={done === items.length ? 'blue' : 'amber'}>
                {done}/{items.length}
              </Badge>
            )}
            <button
              className="textbutton"
              onClick={() => {
                setEditing(emp);
                setForm({ ...emptyEmployee, ...emp.data });
              }}
            >
              Modifica
            </button>
          </span>
        </div>
        {emp.data.externalSource && <p className="smallnote">Dati ricevuti da {emp.data.externalSource}.</p>}
        {!emp.data.active && retention(emp)}
        <ul className="stafflist">
          {items.map(item => (
            <li key={item.key}>
              {ICON[item.status]}
              <span>
                <strong>{item.label}</strong>
                <small>
                  {item.doc
                    ? `${item.doc.data.title}${item.doc.data.expires ? ' · scade ' + fmt(item.doc.data.expires) : ''}`
                    : item.hint}
                </small>
              </span>
              {item.doc?.data.fileId ? (
                <a
                  className="textbutton"
                  href={'/api/files?id=' + item.doc.data.fileId}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apri
                </a>
              ) : (
                <span className="row">
                  <button
                    className="textbutton"
                    title="Abbina un documento già caricato"
                    onClick={() => setLinking({ employee: emp, item })}
                  >
                    <Link2 size={15} />
                  </button>
                  <button
                    className="textbutton"
                    title="Carica il documento"
                    onClick={() => onNewDocument(emp, item)}
                  >
                    <Upload size={15} />
                  </button>
                </span>
              )}
              <em className={'st-label st-' + item.status}>{LABEL[item.status]}</em>
            </li>
          ))}
        </ul>
      </article>
    );
  };

  return (
    <>
      <SectionTitle
        eyebrow="PERSONALE"
        title="Dipendenti"
        text="Per ogni persona i documenti che un controllo del lavoro può chiedere, con quello che manca o scade."
      >
        <button
          className="button primary"
          onClick={() => {
            setEditing(null);
            setForm({ ...emptyEmployee });
          }}
        >
          <Plus size={17} /> Nuovo dipendente
        </button>
      </SectionTitle>
      <div className="notice">
        <div>
          <strong>Dati riservati.</strong>
          <p>
            Visibili solo al titolare: non compaiono al collaboratore né nell’esibizione automatica del
            portale. La lista è indicativa: i documenti obbligatori dipendono da contratto, DVR e incarichi,
            da verificare con il consulente del lavoro.
          </p>
        </div>
      </div>
      <div className="staffgrid">{active.map(card)}</div>
      {!active.length && (
        <div className="panel empty">
          <UserRound />
          <h2>Nessun dipendente in anagrafica</h2>
          <p>Aggiungi le persone o collega Gionti Suite per riceverle in automatico.</p>
        </div>
      )}
      {former.length > 0 && (
        <details className="panel">
          <summary>Rapporti cessati ({former.length})</summary>
          <div className="staffgrid">{former.map(card)}</div>
        </details>
      )}

      <Dialog open={!!form} onOpenChange={v => !v && !busy && setForm(null)}>
        <DialogContent className="presidio-dialog">
          <DialogTitle>{editing ? 'Scheda dipendente' : 'Nuovo dipendente'}</DialogTitle>
          <DialogDescription>Servono per sapere quali documenti chiedere a ciascuno.</DialogDescription>
          {form && (
            <form onSubmit={save}>
              <div className="formgrid">
                <Field label="Nome e cognome *">
                  <input
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label="Mansione">
                  <input
                    maxLength={120}
                    placeholder="Es. banconista, cameriere, cuoco"
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                  />
                </Field>
                <Field label="Assunto il">
                  <input
                    type="date"
                    value={form.hired}
                    onChange={e => setForm({ ...form, hired: e.target.value })}
                  />
                </Field>
                <Field label="Contratto">
                  <input
                    maxLength={60}
                    placeholder="Es. tempo determinato part-time"
                    value={form.contract}
                    onChange={e => setForm({ ...form, contract: e.target.value })}
                  />
                </Field>
                <Field label="Scadenza del contratto">
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm({ ...form, endDate: e.target.value })}
                  />
                </Field>
              </div>
              <label className="checkrow">
                <input
                  type="checkbox"
                  checked={form.extraUe}
                  onChange={e => setForm({ ...form, extraUe: e.target.checked })}
                />
                Cittadino extra-UE (serve il permesso di soggiorno)
              </label>
              <label className="checkrow">
                <input
                  type="checkbox"
                  checked={form.medicalRequired}
                  onChange={e => setForm({ ...form, medicalRequired: e.target.checked })}
                />
                Sorveglianza sanitaria prevista dal DVR (visita medica)
              </label>
              <fieldset className="designations">
                <legend>Incarichi</legend>
                {DESIGNATIONS.map(d => (
                  <label key={d} className="checkrow">
                    <input
                      type="checkbox"
                      checked={form.designations.includes(d)}
                      onChange={e =>
                        setForm({
                          ...form,
                          designations: e.target.checked
                            ? [...form.designations, d]
                            : form.designations.filter(x => x !== d),
                        })
                      }
                    />
                    {d}
                  </label>
                ))}
              </fieldset>
              <label className="checkrow">
                <input
                  type="checkbox"
                  checked={!form.active}
                  onChange={e => setForm({ ...form, active: !e.target.checked })}
                />
                Rapporto cessato
              </label>
              <Field label="Note">
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <div className="formfooter">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  Annulla
                </button>
                <button className="button primary" disabled={busy}>
                  <Save size={16} /> Salva
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!linking} onOpenChange={v => !v && setLinking(null)}>
        <DialogContent className="presidio-dialog">
          <DialogTitle>Abbina un documento</DialogTitle>
          <DialogDescription>
            {linking &&
              `${linking.item.label} di ${linking.employee.data.name}: scegli tra i documenti non ancora abbinati.`}
          </DialogDescription>
          <div className="linkpick">
            {unlinked.map(d => (
              <button key={d.id} className="finding" disabled={busy} onClick={() => link(d)}>
                <span>
                  <strong>{d.data.title}</strong>
                  <small>
                    {d.data.category}
                    {d.data.holder ? ' · ' + d.data.holder : ''}
                  </small>
                </span>
              </button>
            ))}
            {!unlinked.length && <p className="muted">Tutti i documenti sono già abbinati.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
