'use client';
import { useEffect, useState } from 'react';
import { ArchiveRestore, Download, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { Entry, Profile } from '@/lib/product';
import { Action, Badge, download, Field, fmt, Pick, SectionTitle } from './shared';

const kindLabel: Record<string, string> = { document: 'Documento', inspection: 'Controllo', task: 'Azione' };
const entryTitle = (x: Entry) => x.data.title || x.data.authority || 'Senza titolo';

const fields = [
  ['name', 'Nome commerciale'],
  ['legalName', 'Ragione sociale attuale'],
  ['vat', 'Partita IVA'],
  ['address', 'Indirizzo della sede'],
  ['city', 'Comune'],
  ['region', 'Regione'],
  ['activity', 'Attività svolta'],
  ['reviewer', 'Referente tecnico o legale'],
] as const;
const yesNo = ['Sì', 'No', 'Da confermare'];

type Channels = { telegram: boolean; email: boolean; scheduled: boolean };

function ReminderStatus() {
  const [channels, setChannels] = useState<Channels | null>(null);
  useEffect(() => {
    fetch('/api/reminders', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: any) => setChannels(d?.channels || null))
      .catch(() => {});
  }, []);
  const on = (v?: boolean) => <Badge tone={v ? 'blue' : 'gray'}>{v ? 'Attivo' : 'Non configurato'}</Badge>;
  return (
    <section className="panel">
      <h2>Promemoria delle scadenze</h2>
      <p className="muted">
        Ogni mattina Presidio può inviarti le date da riesaminare (a 30, 7, 1 giorno e il giorno stesso) e le
        azioni in scadenza; le date superate vengono ricordate il lunedì.
      </p>
      <div className="archivedrow">
        <span>Invio programmato (GitHub Actions)</span>
        {on(channels?.scheduled)}
      </div>
      <div className="archivedrow">
        <span>Telegram</span>
        {on(channels?.telegram)}
      </div>
      <div className="archivedrow">
        <span>Email</span>
        {on(channels?.email)}
      </div>
      <p className="smallnote">
        Configurazione dal Mac: CONFIGURA_PROMEMORIA.command (vedi la guida, capitolo 0).
      </p>
    </section>
  );
}

export default function ProfileTab({
  draft,
  onDraft,
  archived,
  busy,
  action,
}: {
  draft: Profile;
  onDraft: (profile: Profile) => void;
  archived: Entry[];
  busy: boolean;
  action: Action;
}) {
  const [exporting, setExporting] = useState(false);
  return (
    <>
      <SectionTitle
        eyebrow="IDENTITÀ E PERIMETRO"
        title="La tua azienda"
        text="Completa i dati attuali, verificandoli sui documenti originali."
      >
        <Badge>Una sede · accesso del titolare</Badge>
      </SectionTitle>
      <form
        className="panel profileform"
        onSubmit={async e => {
          e.preventDefault();
          await action({ action: 'profile', data: draft }, 'Profilo aziendale aggiornato');
        }}
      >
        <div className="formgrid">
          {fields.map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                required={key === 'name'}
                maxLength={key === 'address' ? 300 : key === 'vat' ? 30 : 200}
                value={draft[key]}
                onChange={e => onDraft({ ...draft, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Sono presenti lavoratori?">
            <Pick value={draft.staff} options={yesNo} onChange={v => onDraft({ ...draft, staff: v })} />
          </Field>
          <Field label="È presente un dehors?">
            <Pick value={draft.dehors} options={yesNo} onChange={v => onDraft({ ...draft, dehors: v })} />
          </Field>
        </div>
        <Field label="Informativa per il portale dei controlli">
          <textarea
            rows={8}
            maxLength={12000}
            value={draft.portalNotice || ''}
            onChange={e => onDraft({ ...draft, portalNotice: e.target.value })}
            placeholder="Inserisci l’informativa dell’attività: titolare e contatti; dati e finalità; basi giuridiche; fornitori/destinatari ed eventuali trasferimenti; tempi o criteri di conservazione; diritti e modalità di esercizio; reclamo al Garante; campi necessari e modalità alternativa di esibizione. La presa visione non equivale a un consenso generale."
          />
        </Field>
        <div className="formfooter">
          <p className="muted">I confronti usano i campi inseriti; non consultano registri pubblici.</p>
          <button className="button primary" disabled={busy}>
            <Save size={17} />
            Salva profilo
          </button>
        </div>
      </form>
      <div className="panel">
        <h2>Esporta i tuoi dati</h2>
        <p className="muted">
          Copia in formato JSON di profilo, schede e cronologie. I file originali si scaricano dalle
          rispettive schede.
        </p>
        <button
          className="button secondary"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              // Fetched on demand so the export keeps the revision history the live view omits.
              const r = await fetch('/api/state?revisions=1', { cache: 'no-store' });
              const data: any = await r.json();
              if (!r.ok) throw new Error(data.error || 'Esportazione non riuscita');
              download(
                JSON.stringify(
                  { exportedAt: new Date().toISOString(), profile: data.profile, records: data.records },
                  null,
                  2,
                ),
                'presidio-archivio.json',
              );
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download size={16} />
          Esporta schede e cronologie
        </button>
      </div>
      <ReminderStatus />
      <section className="panel" id="archiviati">
        <div className="sectionhead">
          <h2>Archiviati</h2>
          <Badge>{archived.length}</Badge>
        </div>
        <p className="muted">
          Le schede archiviate non compaiono nelle viste di lavoro né nel portale dei controlli. Restano nel
          database, nella cronologia e nell’esportazione: puoi ripristinarle in qualsiasi momento.
        </p>
        {archived.map(x => (
          <div className="archivedrow" key={x.id}>
            <span>
              <strong>{entryTitle(x)}</strong>
              <small>
                {kindLabel[x.kind] || x.kind} · archiviata il {fmt(x.data.archivedAt)}
              </small>
            </span>
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() =>
                action(
                  { action: 'restore', kind: x.kind, id: x.id, version: x.updated },
                  'Scheda ripristinata',
                )
              }
            >
              <ArchiveRestore size={15} /> Ripristina
            </button>
          </div>
        ))}
        {!archived.length && <p className="smallnote">Nessuna scheda archiviata.</p>}
      </section>
    </>
  );
}
