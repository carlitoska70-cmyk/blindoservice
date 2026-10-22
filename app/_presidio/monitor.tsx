'use client';
import { useState } from 'react';
import { AlertTriangle, Eye, FileText, Loader2, Mic, Search, ShieldCheck, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Entry } from '@/lib/product';
import type { DocumentData } from '@/lib/schemas';
import { roomApi, type useRoom } from '../control-room';
import type { Live } from './use-live';

const clock = (s: number) =>
  `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * "Monitora controllo in corso": top half mirrors what the inspector is viewing in the
 * portal, bottom half shows the AI suggestions produced from the live recording.
 */
export default function Monitor({
  room,
  visitId,
  inspectionId,
  live,
  documents,
  onClose,
}: {
  room: ReturnType<typeof useRoom>;
  visitId: string | null;
  inspectionId: string;
  live: Live;
  documents: Entry<DocumentData>[];
  onClose: () => void;
}) {
  const [granting, setGranting] = useState(false);
  const v = visitId ? room.data?.visits.find((x: any) => x.id === visitId) : null;
  const who = v?.data || {};
  const grants = (room.data?.grants || []).filter((g: any) => g.visit_id === visitId);
  const active = grants.find((g: any) => g.document_id === v?.active_doc);
  const events = (room.data?.events || []).filter((e: any) => e.visit_id === visitId);
  const lastSearch = events.find((e: any) => e.kind === 'ricerca')?.data?.query;
  const [latest, ...older] = live.hints;
  const title = (id: string) => documents.find(d => d.id === id)?.data.title || 'Documento';
  const exhibitable = documents.filter(d => d.data.fileId);

  async function grantAll() {
    if (!v) return;
    if (
      !window.confirm(
        `Hai verificato l’identità dell’agente? Verranno resi consultabili ${exhibitable.length} documenti con originale.`,
      )
    )
      return;
    setGranting(true);
    try {
      await roomApi('grants', {
        visitId: v.id,
        identityVerified: true,
        documentIds: exhibitable.map(d => d.id),
      });
      await room.refresh();
      toast.success('Documenti consultabili dall’agente');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="monitor" role="dialog" aria-modal="true" aria-label="Monitora controllo in corso">
      <header className="monitorbar">
        <div className="monitorwho">
          {live.recording ? (
            <span className="recdot" aria-label="Registrazione in corso" />
          ) : (
            <ShieldCheck size={18} />
          )}
          <span>
            <strong>
              {who.firstName ? `${who.firstName} ${who.lastName}` : 'Controllo in corso'}
              {live.recording && <em> · {clock(live.elapsed)}</em>}
            </strong>
            <small>
              {[who.office, who.role].filter(Boolean).join(' · ') || 'Agente non registrato nel portale'}
            </small>
          </span>
        </div>
        {live.phase === 'recording' && (
          <button
            className="button danger compact"
            onClick={() => {
              if (
                window.confirm(
                  'Terminare il controllo? La registrazione verrà archiviata e verrà preparato il rapporto.',
                )
              )
                live.finish();
            }}
          >
            <Square size={15} /> Termina controllo
          </button>
        )}
        {(live.phase === 'idle' || live.phase === 'done') && (
          <button className="button secondary compact" onClick={onClose} aria-label="Chiudi">
            <X size={16} />
          </button>
        )}
      </header>

      <section className="monitortop" aria-label="Cosa sta consultando l’agente">
        {!v ? (
          <div className="monitorempty">
            <Eye />
            <p>
              L’agente non sta usando il portale QR. La registrazione e i suggerimenti funzionano comunque.
            </p>
          </div>
        ) : v.status === 'in_attesa' ? (
          <div className="monitorempty">
            <AlertTriangle />
            <p>L’agente ha inserito i suoi dati e attende i documenti.</p>
            <button className="button primary" disabled={granting || !exhibitable.length} onClick={grantAll}>
              Rendi consultabili i documenti ({exhibitable.length})
            </button>
          </div>
        ) : active ? (
          <>
            <div className="monitorcaption">
              <Eye size={15} /> Sta guardando: <strong>{active.title}</strong>
            </div>
            <iframe
              title={'Documento consultato: ' + active.title}
              src={'/api/files?id=' + encodeURIComponent(active.file_id)}
            />
          </>
        ) : (
          <div className="monitorempty">
            <FileText />
            <p>Nessun documento aperto in questo momento.</p>
            {lastSearch && (
              <p className="muted">
                <Search size={14} /> Ultima ricerca: “{lastSearch}”
              </p>
            )}
            <small className="muted">{grants.length} documenti consultabili dall’agente</small>
          </div>
        )}
      </section>

      <section
        className="monitorbottom"
        aria-label="Suggerimenti dell’intelligenza artificiale"
        aria-live="polite"
      >
        {live.phase === 'finishing' && (
          <div className="monitorempty">
            <Loader2 className="spin" />
            <p>
              Archiviazione della registrazione e preparazione del rapporto…
              {live.pending > 0 && ` (${live.pending} segmenti in elaborazione)`}
            </p>
          </div>
        )}
        {live.phase === 'done' && (
          <div className="monitordone">
            <ShieldCheck />
            <h2>Controllo terminato</h2>
            <p>
              La registrazione originale è archiviata.{live.result?.reportId ? ' Il rapporto è pronto.' : ''}
            </p>
            {live.result?.error && <p className="notice error">{live.result.error}</p>}
            {live.error && <p className="notice error">{live.error}</p>}
            <div className="row">
              {live.result?.pdfFileId && (
                <a
                  className="button primary"
                  href={'/api/files?id=' + live.result.pdfFileId}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apri il PDF del rapporto
                </a>
              )}
              {live.result?.reportId && (
                <a
                  className="button secondary"
                  href={'/rapporto?id=' + live.result.reportId}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vedi rapporto
                </a>
              )}
            </div>
          </div>
        )}
        {live.phase === 'recording' && (
          <>
            {live.warning && <p className="notice">{live.warning}</p>}
            {latest ? (
              <article className={'hintcard' + (latest.urgency === 'alta' ? ' urgent' : '')}>
                <p className="eyebrow">DOMANDA RILEVATA</p>
                <p className="hintq">“{latest.question}”</p>
                <p className="eyebrow">RISPOSTA SUGGERITA</p>
                <p className="hinta">{latest.answer}</p>
                {latest.documents.length > 0 && (
                  <p className="hintdocs">
                    {latest.documents.map(id => (
                      <span key={id} className="badge blue">
                        {title(id)}
                      </span>
                    ))}
                    {latest.searchHint && <span className="muted"> · fai cercare “{latest.searchHint}”</span>}
                  </p>
                )}
                {latest.caution && <p className="hintcaution">{latest.caution}</p>}
              </article>
            ) : (
              <div className="monitorempty">
                <Mic />
                <p>In ascolto. Quando l’agente fa una domanda, qui compare la risposta suggerita.</p>
              </div>
            )}
            {older.length > 0 && (
              <details className="hintolder">
                <summary>Suggerimenti precedenti ({older.length})</summary>
                {older.map(h => (
                  <p key={h.id}>
                    <strong>“{h.question}”</strong> → {h.answer}
                  </p>
                ))}
              </details>
            )}
            <div className="transcripttail">
              {live.segments.slice(-3).map(s => (
                <p key={s.id}>{s.text}</p>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
