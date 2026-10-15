'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Entry } from '@/lib/product';
import type { DocumentData } from '@/lib/schemas';
import { roomApi, type useRoom } from '../control-room';
import { api } from './shared';

/**
 * Automatic exhibition: with this on, an inspector who identifies through the QR can
 * search the selected documents at once, even when the owner is absent.
 */
export default function AutoShare({
  room,
  documents,
  onSaved,
}: {
  room: ReturnType<typeof useRoom>;
  documents: Entry<DocumentData>[];
  onSaved: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const enabled = !!room.data?.autoShare;
  const withFile = documents.filter(d => d.data.fileId);
  const shared = withFile.filter(d => d.data.autoShare);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mark(list: Entry<DocumentData>[], value: boolean) {
    for (const d of list)
      await api({
        action: 'update',
        kind: 'document',
        id: d.id,
        version: d.updated,
        data: { ...d.data, autoShare: value },
      });
    await onSaved();
  }

  return (
    <section className="panel autoshare">
      <div className="sectionhead">
        <div>
          <h2>Esibizione automatica</h2>
          <p className="muted">
            Quando è attiva, l’agente che inserisce nome, cognome, targa e ufficio può cercare subito i
            documenti selezionati, anche se tu non ci sei. Ricevi l’avviso del controllo in corso su Telegram
            o email.
          </p>
        </div>
        <button
          className={'button ' + (enabled ? 'secondary' : 'primary')}
          disabled={busy || !room.data}
          onClick={() =>
            run(
              async () => {
                await roomApi('settings', { autoShare: !enabled });
                await room.refresh();
              },
              enabled ? 'Esibizione automatica disattivata' : 'Esibizione automatica attivata',
            )
          }
        >
          {enabled ? 'Disattiva' : 'Attiva'}
        </button>
      </div>
      <p>
        <span className={'badge ' + (enabled ? 'blue' : 'gray')}>{enabled ? 'Attiva' : 'Non attiva'}</span>{' '}
        {shared.length} di {withFile.length} documenti con originale sono consultabili senza la tua
        approvazione.
      </p>
      <div className="row">
        <button
          className="button secondary compact"
          disabled={busy || shared.length === withFile.length}
          onClick={() =>
            run(
              () =>
                mark(
                  withFile.filter(d => !d.data.autoShare),
                  true,
                ),
              'Tutti i documenti selezionati',
            )
          }
        >
          Seleziona tutti
        </button>
        <button
          className="button secondary compact"
          disabled={busy || !shared.length}
          onClick={() => run(() => mark(shared, false), 'Selezione azzerata')}
        >
          Nessuno
        </button>
      </div>
      <div className="autosharelist">
        {withFile.map(d => (
          <label key={d.id} className="checkrow">
            <input
              type="checkbox"
              checked={!!d.data.autoShare}
              disabled={busy}
              onChange={e =>
                run(
                  () => mark([d], e.target.checked),
                  e.target.checked ? 'Documento consultabile' : 'Documento escluso',
                )
              }
            />
            <span>
              {d.data.title}
              <small className="muted"> · {d.data.category}</small>
            </span>
          </label>
        ))}
        {!withFile.length && <p className="smallnote">Carica prima i documenti con il loro originale.</p>}
      </div>
      <p className="smallnote">
        Le note interne non sono mai visibili all’agente. Puoi revocare l’accesso in qualsiasi momento dalla
        sessione qui sotto.
      </p>
    </section>
  );
}
