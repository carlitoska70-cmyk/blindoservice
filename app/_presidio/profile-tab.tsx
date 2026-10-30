'use client';
import { useEffect, useState } from 'react';
import { ArchiveRestore, Download, Fingerprint, Save } from 'lucide-react';
import { deletePasskey, passkeySupported, registerPasskey } from '@/lib/passkey-client';
import { toast } from 'sonner';
import type { Entry, Profile } from '@/lib/product';
import { Action, Badge, download, Field, fmt, Pick, SectionTitle } from './shared';
import LinksPanel from './links-panel';
import AiCheckPanel, { type AiCheck } from './ai-check-panel';
import PhoneAlerts from './phone-alerts';
import { NOTICE_TODO, noticeProblem, portalNoticeTemplate } from '@/lib/portal-notice';

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

type Passkey = { id: string; label: string; created: string; last_used: string | null };

function PasskeyPanel() {
  const [list, setList] = useState<Passkey[] | null>(null),
    [busy, setBusy] = useState(false);
  const load = () =>
    fetch('/api/auth/passkey', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { passkeys: [] }))
      .then((d: any) => setList(d.passkeys))
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  if (!passkeySupported()) return null;
  return (
    <section className="panel">
      <div className="sectionhead">
        <h2>Accesso con passkey</h2>
        <Badge tone={list?.length ? 'blue' : 'gray'}>{list?.length ? 'Attivo' : 'Non configurato'}</Badge>
      </div>
      <p className="muted">
        Entra con Face ID, Touch ID o il PIN del dispositivo, senza digitare la password. La password resta
        valida come accesso di riserva. Se perdi un dispositivo, rimuovi qui la sua passkey.
      </p>
      {list?.map(x => (
        <div className="archivedrow" key={x.id}>
          <span>
            <strong>{x.label}</strong>
            <small>
              Aggiunta il {fmt(x.created)}
              {x.last_used ? ' · ultimo uso ' + fmt(x.last_used) : ''}
            </small>
          </span>
          <button
            className="button secondary compact"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Rimuovere questa passkey? Su quel dispositivo servirà la password.'))
                return;
              setBusy(true);
              try {
                await deletePasskey(x.id);
                await load();
                toast.success('Passkey rimossa');
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Rimuovi
          </button>
        </div>
      ))}
      <button
        className="button secondary"
        disabled={busy}
        style={{ marginTop: 12 }}
        onClick={async () => {
          const label = window.prompt('Nome del dispositivo (es. iPhone di Carlo)', 'iPhone');
          if (label === null) return;
          setBusy(true);
          try {
            await registerPasskey(label);
            await load();
            toast.success('Passkey aggiunta');
          } catch (e) {
            const err = e as Error;
            toast.error(err.name === 'NotAllowedError' ? 'Registrazione annullata' : err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Fingerprint size={16} /> Aggiungi passkey su questo dispositivo
      </button>
    </section>
  );
}

function ArchivedList({ archived, busy, action }: { archived: Entry[]; busy: boolean; action: Action }) {
  return (
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
              action({ action: 'restore', kind: x.kind, id: x.id, version: x.updated }, 'Scheda ripristinata')
            }
          >
            <ArchiveRestore size={15} /> Ripristina
          </button>
        </div>
      ))}
      {!archived.length && <p className="smallnote">Nessuna scheda archiviata.</p>}
    </section>
  );
}

export default function ProfileTab({
  aiCheck,
  staff = false,
  draft,
  onDraft,
  archived,
  busy,
  action,
  onChanged = async () => {},
}: {
  aiCheck?: AiCheck;
  onChanged?: () => Promise<unknown>;
  staff?: boolean;
  draft: Profile;
  onDraft: (profile: Profile) => void;
  archived: Entry[];
  busy: boolean;
  action: Action;
}) {
  const [exporting, setExporting] = useState(false);
  if (staff)
    return (
      <>
        <SectionTitle
          eyebrow="ACCESSO COLLABORATORE"
          title="La tua azienda"
          text="Profilo, accessi e impostazioni sono gestiti dal titolare."
        >
          <Badge>Collaboratore</Badge>
        </SectionTitle>
        <div className="notice">
          <div>
            <strong>Puoi caricare e aggiornare documenti, azioni e valutazioni del catalogo.</strong>
            <p>Controlli, cronologie, audio e accessi QR sono riservati al titolare.</p>
          </div>
        </div>
        <ArchivedList archived={archived} busy={busy} action={action} />
      </>
    );
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
        <div className="row noticehelp">
          <button
            type="button"
            className="textbutton"
            onClick={() => {
              const current = (draft.portalNotice || '').trim();
              if (
                current &&
                !window.confirm('Sostituire il testo attuale con il modello? Il testo attuale andrà perso.')
              )
                return;
              onDraft({ ...draft, portalNotice: portalNoticeTemplate(draft) });
            }}
          >
            Usa il modello di informativa
          </button>
          {draft.portalNotice && noticeProblem(draft.portalNotice) && (
            <small className="muted">
              {draft.portalNotice.includes(NOTICE_TODO)
                ? `Completa le parti «${NOTICE_TODO}» prima di attivare il portale.`
                : 'Il testo è troppo breve per attivare il portale.'}
            </small>
          )}
        </div>
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
      <AiCheckPanel last={aiCheck} onChanged={onChanged} />
      <PhoneAlerts />
      <PasskeyPanel />
      <LinksPanel onChanged={onChanged} />
      <ArchivedList archived={archived} busy={busy} action={action} />
    </>
  );
}
