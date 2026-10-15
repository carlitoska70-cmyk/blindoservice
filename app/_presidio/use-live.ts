'use client';
import { useEffect, useRef, useState } from 'react';
import { api, upload } from './shared';

export type LiveSegment = { id: string; seq: number; offsetMs: number; text: string };
export type LiveHint = {
  id: string;
  seq: number;
  question: string;
  answer: string;
  documents: string[];
  searchHint: string;
  caution: string;
  urgency: 'alta' | 'normale';
};
type Phase = 'idle' | 'recording' | 'finishing' | 'done';

const SEGMENT_MS = 8000;
const BITRATE = 32000; // speech: ~15 MB per hour for the archived original
const mimeType = () =>
  ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(x => MediaRecorder.isTypeSupported(x)) || '';
const ext = (type: string) => (type.includes('mp4') ? 'm4a' : 'webm');

/**
 * Live inspection on the operator's device: one continuous recording (the original
 * that is archived with its SHA-256) plus 8-second segments sent for transcription
 * and suggestions while the inspection is running.
 */
export function useLive({ onArchived }: { onArchived: () => Promise<unknown> }) {
  const [phase, setPhase] = useState<Phase>('idle'),
    [segments, setSegments] = useState<LiveSegment[]>([]),
    [hints, setHints] = useState<LiveHint[]>([]),
    [error, setError] = useState(''),
    [warning, setWarning] = useState(''),
    [elapsed, setElapsed] = useState(0),
    [result, setResult] = useState<{
      reportId: string | null;
      pdfFileId?: string | null;
      error?: string;
    } | null>(null),
    [pending, setPending] = useState(0);
  const stream = useRef<MediaStream | null>(null),
    master = useRef<MediaRecorder | null>(null),
    masterChunks = useRef<Blob[]>([]),
    segment = useRef<MediaRecorder | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    inflight = useRef(new Set<Promise<unknown>>()),
    seq = useRef(0),
    startedAt = useRef(0),
    inspection = useRef(''),
    running = useRef(false),
    wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (running.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      running.current = false;
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function track<T>(p: Promise<T>) {
    inflight.current.add(p);
    setPending(inflight.current.size);
    p.finally(() => {
      inflight.current.delete(p);
      setPending(inflight.current.size);
    });
    return p;
  }

  async function send(blob: Blob, n: number, offsetMs: number) {
    const form = new FormData();
    form.append('inspectionId', inspection.current);
    form.append('seq', String(n));
    form.append('offsetMs', String(offsetMs));
    form.append('file', new File([blob], `segmento-${n}.${ext(blob.type)}`, { type: blob.type }));
    const r = await fetch('/api/live', { method: 'POST', body: form });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Segmento non elaborato');
    if (d.segment) setSegments(prev => [...prev, d.segment].sort((a, b) => a.seq - b.seq));
    if (d.hint) setHints(prev => [d.hint, ...prev]);
  }

  // Each segment is a self-contained file (a fresh recorder), so it can be transcribed alone.
  function nextSegment(type: string) {
    if (!running.current || !stream.current) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(
        stream.current,
        type ? { mimeType: type, audioBitsPerSecond: BITRATE } : undefined,
      );
    } catch {
      setWarning('Suggerimenti in tempo reale non disponibili su questo browser: la registrazione continua.');
      return;
    }
    const parts: Blob[] = [];
    const n = seq.current++;
    const offsetMs = Date.now() - startedAt.current;
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || type || 'audio/webm' });
      if (blob.size > 2000)
        track(
          send(blob, n, offsetMs).catch(e => {
            setWarning((e as Error).message + ' — la registrazione originale non è interessata.');
          }),
        );
    };
    segment.current = rec;
    rec.start();
    timer.current = setTimeout(() => {
      if (rec.state === 'recording') rec.stop();
      nextSegment(type);
    }, SEGMENT_MS);
  }

  /** Call directly from the button handler: the microphone prompt needs the user's tap. */
  async function requestMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw new Error('Registrazione non supportata da questo browser.');
    stream.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  async function start(inspectionId: string) {
    if (!stream.current) await requestMicrophone();
    const type = mimeType();
    inspection.current = inspectionId;
    masterChunks.current = [];
    seq.current = 0;
    setSegments([]);
    setHints([]);
    setError('');
    setWarning('');
    setResult(null);
    const rec = new MediaRecorder(
      stream.current!,
      type ? { mimeType: type, audioBitsPerSecond: BITRATE } : undefined,
    );
    rec.ondataavailable = e => e.data.size && masterChunks.current.push(e.data);
    master.current = rec;
    startedAt.current = Date.now();
    running.current = true;
    rec.start(1000);
    setElapsed(0);
    setPhase('recording');
    try {
      wake.current = await (navigator as any).wakeLock?.request('screen');
    } catch {}
    nextSegment(type);
  }

  async function finish() {
    if (phase !== 'recording') return;
    setPhase('finishing');
    running.current = false;
    if (timer.current) clearTimeout(timer.current);
    const seg = segment.current;
    if (seg?.state === 'recording')
      await new Promise<void>(resolve => {
        const upload = seg.onstop;
        seg.onstop = ev => {
          upload?.call(seg, ev);
          resolve();
        };
        seg.stop();
      });
    const rec = master.current!;
    const original = await new Promise<File>(resolve => {
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        resolve(
          new File(
            masterChunks.current,
            `controllo-${new Date(startedAt.current).toISOString().replace(/[:.]/g, '-')}.${ext(type)}`,
            { type },
          ),
        );
      };
      rec.stop();
    });
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    wake.current?.release().catch(() => {});
    // Last segments first, so the report sees the whole conversation.
    await Promise.allSettled([...inflight.current]);
    let audioEventId: string | undefined;
    try {
      const f = await upload(original);
      const ev = await api({
        action: 'create',
        kind: 'event',
        data: {
          inspectionId: inspection.current,
          speaker: 'Audio del controllo',
          text: `Registrazione originale continua (${Math.round((Date.now() - startedAt.current) / 60000)} min), avviata da “Monitora controllo in corso”.`,
          tag: 'Registrazione',
          offset: 0,
          fileId: f.id,
          fileName: f.name,
        },
      });
      audioEventId = ev.id;
    } catch (e) {
      // Keep a local copy if the upload fails: the original must never be lost.
      const url = URL.createObjectURL(original);
      const a = document.createElement('a');
      a.href = url;
      a.download = original.name;
      a.click();
      setError(
        'Caricamento della registrazione non riuscito: ne è stata scaricata una copia sul dispositivo. ' +
          (e as Error).message,
      );
    }
    try {
      const r = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId: inspection.current, audioEventId }),
      });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error || 'Chiusura non riuscita');
      setResult(d);
    } catch (e) {
      setError((e as Error).message);
    }
    await onArchived().catch(() => {});
    setPhase('done');
  }

  return {
    phase,
    segments,
    hints,
    error,
    warning,
    elapsed,
    result,
    pending,
    recording: phase === 'recording',
    requestMicrophone,
    start,
    finish,
    reset: () => {
      setPhase('idle');
      setResult(null);
    },
  };
}
export type Live = ReturnType<typeof useLive>;
