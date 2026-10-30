'use client';
import { useState } from 'react';
import { BellRing, Check, Loader2, Mic, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, fmt } from './shared';

type Check = { voce: string; modello: string; ok: boolean; ms: number; esito: string };
export type AiCheck = {
  at: string;
  soloMicrofono?: boolean;
  ok: boolean;
  checks: Check[];
  avvisi: { holding: boolean; telegram: boolean; email: boolean; push?: number };
  spesa?: { mese: number; tetto: number | null };
};
const MIC_MS = 5000;

async function send(audio: Blob, onlyMic: boolean): Promise<AiCheck> {
  const form = new FormData();
  form.append(
    'audio',
    new File([audio], audio.type.includes('mp4') ? 'prova.m4a' : 'prova.webm', { type: audio.type }),
  );
  if (onlyMic) form.append('solo', 'microfono');
  const r = await fetch('/api/diagnostica', { method: 'POST', body: form });
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || 'Prova non riuscita');
  return d;
}

/** Records a few seconds from this device's microphone, as the live inspection does. */
async function record(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(x =>
      MediaRecorder.isTypeSupported(x),
    );
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    const done = new Promise<void>(resolve => (rec.onstop = () => resolve()));
    rec.start();
    await new Promise(resolve => setTimeout(resolve, MIC_MS));
    rec.stop();
    await done;
    return new Blob(parts, { type: rec.mimeType || type || 'audio/webm' });
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
}

/**
 * Before the first real inspection: the AI services of the live inspection, tried with the real key,
 * the microphone of this device, and whether alerts reach the owner's phone.
 */
export default function AiCheckPanel({
  last,
  onChanged,
}: {
  last?: AiCheck;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<'' | 'ia' | 'mic'>(''),
    [result, setResult] = useState<AiCheck | undefined>(last);
  const run = async (kind: 'ia' | 'mic') => {
    setBusy(kind);
    try {
      const audio =
        kind === 'ia' ? await (await fetch('/prova-ia.m4a', { cache: 'no-store' })).blob() : await record();
      const r = await send(audio, kind === 'mic');
      setResult(r);
      if (kind === 'ia') await onChanged();
      toast[r.ok ? 'success' : 'error'](
        r.ok ? 'Tutto funziona' : 'Qualcosa non funziona: guarda le righe in rosso',
      );
    } catch (e) {
      const err = e as Error;
      toast.error(
        err.name === 'NotAllowedError' ? 'Permesso del microfono negato su questo dispositivo' : err.message,
      );
    } finally {
      setBusy('');
    }
  };
  const a = result?.avvisi;
  return (
    <section className="panel">
      <p className="eyebrow">PRIMA DEL PRIMO CONTROLLO</p>
      <h2>Prova l’IA e gli avvisi</h2>
      <p className="muted">
        Prova con la tua chiave OpenAI la trascrizione, i suggerimenti, il rapporto e la ricerca sui siti
        ufficiali. Con «Prova il microfono» parli per 5 secondi su questo dispositivo, come durante un
        controllo.
      </p>
      <div className="row aicheck-actions">
        <button className="button primary" disabled={!!busy} onClick={() => run('ia')}>
          {busy === 'ia' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Prova l’IA
        </button>
        <button className="button secondary" disabled={!!busy} onClick={() => run('mic')}>
          {busy === 'mic' ? <Loader2 size={16} className="spin" /> : <Mic size={16} />}
          {busy === 'mic' ? ' Parla adesso…' : ' Prova il microfono'}
        </button>
      </div>
      {result && (
        <>
          <p className="muted">
            {result.soloMicrofono ? 'Prova del microfono' : 'Ultima prova'} del {fmt(result.at.slice(0, 10))}{' '}
            alle {new Date(result.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <ul className="checklist">
            {result.checks.map(c => (
              <li key={c.voce} className={c.ok ? 'ok' : 'ko'}>
                {c.ok ? <Check size={16} /> : <X size={16} />}
                <span>
                  <strong>{c.voce}</strong>{' '}
                  <small className="muted">
                    {c.modello} · {(c.ms / 1000).toFixed(1)} s
                  </small>
                  <br />
                  <small>{c.esito}</small>
                </span>
              </li>
            ))}
          </ul>
          {a && (
            <p className="aicheck-alerts">
              <BellRing size={16} /> Avvisi sul telefono quando arriva un controllore:{' '}
              {a.holding || a.telegram || a.email || a.push ? (
                <Badge tone="green">
                  {[
                    a.push && `${a.push} ${a.push === 1 ? 'telefono' : 'telefoni'} con Blindo`,
                    a.holding && 'Gionti Holding',
                    a.telegram && 'Telegram',
                    a.email && 'email',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Badge>
              ) : (
                <Badge tone="red">nessuno: attivali qui sotto in «Avvisi sul telefono»</Badge>
              )}
            </p>
          )}
          {result.spesa && (
            <p className="smallnote">
              Spesa IA stimata questo mese: {result.spesa.mese.toFixed(2).replace('.', ',')} €
              {result.spesa.tetto !== null
                ? ` su un tetto di ${result.spesa.tetto.toFixed(2).replace('.', ',')} €`
                : ' (nessun tetto)'}
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}
