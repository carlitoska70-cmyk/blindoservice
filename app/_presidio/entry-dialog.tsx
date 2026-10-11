'use client';
import { Archive, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Entry } from '@/lib/product';
import DocumentEditor from '../document-editor';
import { Field, Kind, Pick } from './shared';

const titles: Record<Kind, [string, string]> = {
  document: ['Aggiungi un documento', 'Modifica scheda'],
  inspection: ['Inizia il fascicolo', 'Dati ed esito del controllo'],
  task: ['Nuova azione', 'Modifica azione'],
};

export default function EntryDialog({
  kind,
  editing,
  form,
  onForm,
  busy,
  onBusy,
  onClose,
  onSubmit,
  onArchive,
}: {
  kind: Kind | '';
  editing: Entry | null;
  form: any;
  onForm: (form: any) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onArchive: (entry: Entry) => void;
}) {
  const text = (key: string, max: number, extra: Record<string, unknown> = {}) => ({
    maxLength: max,
    value: form[key] || '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onForm({ ...form, [key]: e.target.value }),
    ...extra,
  });
  return (
    <Dialog
      open={!!kind}
      onOpenChange={v => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="presidio-dialog">
        <DialogTitle>{kind && titles[kind][editing ? 1 : 0]}</DialogTitle>
        <DialogDescription>
          {kind === 'inspection'
            ? 'Annota i dati dichiarati. L’identità degli interlocutori si verifica separatamente.'
            : 'I campi vengono salvati nel tuo spazio riservato.'}
        </DialogDescription>
        <form onSubmit={onSubmit}>
          {kind === 'document' && (
            <DocumentEditor value={form} onChange={onForm} busy={busy} onBusy={onBusy} />
          )}
          {kind === 'inspection' && (
            <>
              <Field label="Ente / ufficio *">
                <input
                  {...text('authority', 200, {
                    required: true,
                    placeholder: 'Es. ASP, Polizia municipale, Ispettorato…',
                  })}
                />
              </Field>
              <Field label="Oggetto dichiarato del controllo *">
                <input {...text('scope', 200, { required: true })} />
              </Field>
              <Field label="Nomi e qualifiche dichiarati">
                <textarea {...text('officers', 1000, { rows: 2 })} />
              </Field>
              <Field label="Riferimento / protocollo">
                <input {...text('reference', 200)} />
              </Field>
              {editing && (
                <>
                  <Field label="Stato del fascicolo">
                    <Pick
                      value={form.status || 'aperto'}
                      options={['aperto', 'concluso']}
                      onChange={v =>
                        onForm({
                          ...form,
                          status: v,
                          ended: v === 'concluso' ? new Date().toISOString() : '',
                        })
                      }
                    />
                  </Field>
                  <Field label="Esito e prossime attività (annotazione del responsabile)">
                    <textarea {...text('outcome', 4000, { rows: 4 })} />
                  </Field>
                </>
              )}
              <p className="smallnote">
                Il modulo può essere compilato dal responsabile. Non presume obblighi dei controllori di
                registrarsi o usare il QR.
              </p>
            </>
          )}
          {kind === 'task' && (
            <>
              <Field label="Che cosa occorre fare? *">
                <input {...text('title', 200, { required: true })} />
              </Field>
              <Field label="Responsabile">
                <input {...text('responsible', 200)} />
              </Field>
              <Field label="Data concordata">
                <input
                  type="date"
                  value={form.due || ''}
                  onChange={e => onForm({ ...form, due: e.target.value })}
                />
              </Field>
              <Field label="Istruzioni e risultato atteso">
                <textarea {...text('notes', 4000, { rows: 4 })} />
              </Field>
            </>
          )}
          <div className="formfooter">
            {editing && (
              <button
                type="button"
                className="textbutton archivebutton"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Archiviare questa scheda? Sparirà dalle viste di lavoro e dal portale; potrai ripristinarla da Azienda › Archiviati.',
                    )
                  )
                    onArchive(editing);
                }}
              >
                <Archive size={15} /> Archivia
              </button>
            )}
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              Annulla
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              {busy ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
