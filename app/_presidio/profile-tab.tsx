'use client';
import { useState } from 'react';
import { Download, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { Profile } from '@/lib/product';
import { Action, Badge, download, Field, Pick, SectionTitle } from './shared';

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

export default function ProfileTab({
  draft,
  onDraft,
  busy,
  action,
}: {
  draft: Profile;
  onDraft: (profile: Profile) => void;
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
    </>
  );
}
