'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Entry } from '@/lib/product';
import { api, upload } from './shared';

const MAX_SEGMENT = 18 * 1024 * 1024;
const MAX_ATTACHMENT = 20 * 1024 * 1024;

type Captured = { file: File; url: string };

// Owner-side audio capture for an inspection. The recording stays local until it
// is archived; on upload failure the local copy remains downloadable.
export function useRecorder({
  setBusy,
  refresh,
}: {
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<unknown>;
}) {
  const [rec, setRec] = useState(false),
    [ready, setReady] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [captured, setCapturedState] = useState<Captured | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    recAt = useRef(0),
    inspectionRef = useRef('');

  const setCaptured = useCallback((file: File | null) => {
    setCapturedState(prev => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
  }, []);

  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(x => x.stop());
    },
    [],
  );
  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - recAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [rec]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (rec || captured) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [rec, captured]);

  async function persist(file: File, inspectionId: string, started: string, recordedAt: number) {
    setBusy(true);
    try {
      const f = await upload(file);
      await api({
        action: 'create',
        kind: 'event',
        data: {
          inspectionId,
          speaker: 'Audio del controllo',
          text:
            'Segmento audio originale. Inizio acquisizione: ' +
            (recordedAt ? new Date(recordedAt).toISOString() : 'non rilevato, allegato esterno') +
            '. Trascrizione da verificare.',
          tag: 'Registrazione',
          offset: Math.max(0, Math.floor(((recordedAt || Date.now()) - Date.parse(started)) / 1000)),
          fileId: f.id,
          fileName: f.name,
        },
      });
      setCaptured(null);
      await refresh();
      toast.success('Audio archiviato automaticamente');
    } catch (e) {
      toast.error((e as Error).message + ' L’audio resta disponibile: salva la copia locale.');
    } finally {
      setBusy(false);
    }
  }

  async function start(current: Entry) {
    if (!ready) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error('Registrazione non supportata: puoi allegare un audio già acquisito.');
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(x =>
        MediaRecorder.isTypeSupported(x),
      );
      const r = new MediaRecorder(
        s,
        mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 },
      );
      recorder.current = r;
      let chunks: Blob[] = [];
      let size = 0;
      inspectionRef.current = current.id;
      r.ondataavailable = e => {
        if (!e.data.size) return;
        chunks.push(e.data);
        size += e.data.size;
        if (size > MAX_SEGMENT && r.state === 'recording') {
          r.stop();
          toast.info('Raggiunto il limite del segmento. Salva questo audio prima di proseguire.');
        }
      };
      r.onstop = () => {
        s.getTracks().forEach(x => x.stop());
        setRec(false);
        const type = r.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File(
          chunks,
          ['controllo', new Date().toISOString().replace(/[:.]/g, '-')].join('-') + '.' + ext,
          { type },
        );
        setCaptured(file);
        chunks = [];
        persist(file, inspectionRef.current, current.data.started, recAt.current);
      };
      r.onerror = () => {
        toast.error('Registrazione interrotta. Verifica l’audio recuperato.');
        if (r.state === 'recording') r.stop();
        s.getTracks().forEach(x => x.stop());
        setRec(false);
      };
      recAt.current = Date.now();
      setElapsed(0);
      r.start(1000);
      setRec(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return {
    rec,
    ready,
    setReady,
    elapsed,
    audio: captured?.file ?? null,
    audioUrl: captured?.url ?? '',
    /** A recording is running or an audio file is waiting to be archived. */
    pending: rec || !!captured,
    start,
    stop: () => recorder.current?.stop(),
    save: async (current: Entry) => {
      if (captured)
        await persist(
          captured.file,
          inspectionRef.current || current.id,
          current.data.started,
          recAt.current,
        );
    },
    attach: (file: File, current: Entry) => {
      if (file.size > MAX_ATTACHMENT) {
        toast.error('Massimo 20 MB');
        return;
      }
      inspectionRef.current = current.id;
      recAt.current = 0;
      setCaptured(file);
    },
  };
}
export type Recorder = ReturnType<typeof useRecorder>;
