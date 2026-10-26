import { env } from 'cloudflare:workers';
import { db, rate, response } from '@/lib/portal-server';
import { getOperator } from '@/lib/operator';
import { AiError, responsesJson, transcribe } from '@/lib/openai';
import { HINT_MODEL, REPORT_MODEL, TRANSCRIBE_MODEL } from '@/lib/live';
import { NEWS_DOMAINS, NEWS_MODEL, allowedUrl } from '@/lib/news';
import { channels, type NotifyEnv } from '@/lib/notify';
export const dynamic = 'force-dynamic';

// «Prova l'IA»: before a real inspection the owner checks, with the real key, every AI service the
// live inspection and the news use, plus whether alerts reach the phone. The result is kept as the
// owner's 'ai_check' record so the readiness guide knows it.

type Check = { voce: string; modello: string; ok: boolean; ms: number; esito: string };
const MAX_AUDIO = 2 * 1024 * 1024;

function explain(e: unknown) {
  const m =
    e instanceof AiError ? e.message : e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : '';
  const status = Number(m.match(/\d{3}$/)?.[0]);
  if (status === 401) return 'Chiave OpenAI non valida o revocata';
  if (status === 403 || status === 404) return 'Il modello non è disponibile per questa chiave';
  if (status === 429) return 'Credito o limiti OpenAI esauriti';
  if (status >= 500) return 'OpenAI non risponde in questo momento';
  if (m === 'timeout') return 'Nessuna risposta in tempo';
  if (m === 'Risposta non strutturata') return 'Risposta non nel formato atteso';
  return 'Prova non riuscita';
}

async function step(voce: string, modello: string, run: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    const esito = await run();
    return { voce, modello, ok: true, ms: Date.now() - t, esito: esito.slice(0, 300) };
  } catch (e) {
    return { voce, modello, ok: false, ms: Date.now() - t, esito: explain(e) };
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    if (req.headers.get('origin') !== url.origin) return response({ error: 'Origine non valida' }, 403);
    const user = await getOperator();
    if (!user) return response({ error: 'Accesso richiesto' }, 401);
    if (!env.OPENAI_API_KEY)
      return response({ error: 'Servizio IA non collegato: manca la chiave OpenAI' }, 503);
    await rate('diagnostica:' + user.userId, 6, 3600);
    const form = await req.formData();
    const audio = form.get('audio');
    if (
      !(audio instanceof File) ||
      audio.size === 0 ||
      audio.size > MAX_AUDIO ||
      !audio.type.startsWith('audio/')
    )
      return response({ error: 'Audio di prova non valido' }, 400);
    const onlyMic = form.get('solo') === 'microfono';
    const ai = { key: env.OPENAI_API_KEY, base: env.OPENAI_BASE_URL };
    const name = audio.type.includes('mp4') || audio.type.includes('m4a') ? 'prova.m4a' : 'prova.webm';
    const checks: Check[] = [
      await step('Trascrizione dell’audio', TRANSCRIBE_MODEL, async () => {
        const text = await transcribe(ai, audio, name, { model: TRANSCRIBE_MODEL, timeoutMs: 30000 });
        if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) throw new AiError('Risposta non strutturata');
        return `«${text}»`;
      }),
    ];
    if (!onlyMic) {
      const json = async (model: string) => {
        const raw: any = await responsesJson(ai, {
          model,
          instructions: 'Controllo tecnico. Rispondi solo con il JSON {"pronto": true}.',
          input: 'prova',
          maxTokens: 50,
          timeoutMs: 30000,
        });
        if (raw?.pronto !== true) throw new AiError('Risposta non strutturata');
        return 'Risponde nel formato giusto';
      };
      checks.push(await step('Suggerimenti durante il controllo', HINT_MODEL, () => json(HINT_MODEL)));
      checks.push(await step('Rapporto finale', REPORT_MODEL, () => json(REPORT_MODEL)));
      checks.push(
        await step('Ricerca sui siti ufficiali', NEWS_MODEL, async () => {
          const raw: any = await responsesJson(ai, {
            model: NEWS_MODEL,
            instructions:
              'Cerca la pagina principale del Comune di Palermo. Rispondi solo con il JSON {"url": "indirizzo della pagina"}.',
            input: 'prova',
            maxTokens: 300,
            timeoutMs: 60000,
            webSearch: true,
            allowedDomains: NEWS_DOMAINS,
          });
          if (!allowedUrl(String(raw?.url || ''))) throw new AiError('Risposta non strutturata');
          return new URL(raw.url).hostname;
        }),
      );
    }
    const on = channels(env as unknown as NotifyEnv);
    const avvisi = {
      holding: !!(env.HOLDING_SEGNALE_KEY || '').trim(),
      telegram: on.telegram,
      email: on.email,
    };
    const result = {
      at: new Date().toISOString(),
      soloMicrofono: onlyMic,
      ok: checks.every(c => c.ok),
      checks,
      avvisi,
    };
    if (!onlyMic) {
      await db()
        .prepare(
          "INSERT INTO records(id,owner,kind,data,created,updated) VALUES(?,?,'ai_check',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated WHERE records.owner=excluded.owner AND records.kind='ai_check'",
        )
        .bind('ia:' + user.userId, user.userId, JSON.stringify(result), result.at, result.at)
        .run();
    }
    return response(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('Troppe'))
      return response({ error: 'Hai già fatto molte prove: riprova tra un’ora.' }, 429);
    console.error('diagnostica failed', msg || 'unknown');
    return response({ error: 'Prova non riuscita. Riprova più tardi.' }, 502);
  }
}
