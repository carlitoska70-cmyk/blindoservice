// Monthly AI spending cap of a merchant's copy (AI_TETTO_EURO, set by the factory). The cost of every call
// is estimated from the usage OpenAI returns; above the cap the AI stops until the 1st of next month,
// while archive, portal and recordings keep working. Carlo's own copy has no cap.
// Self-contained (no imports) so the Node tests can load it directly.

export class AiBudgetError extends Error {}

type Env = { DB?: D1Database; AI_TETTO_EURO?: string };
export type Usage = { model: string; usage?: any; webSearch?: boolean; audioBytes?: number };
export type Meter = { before(): Promise<void>; after(u: Usage): Promise<void> };

/** Euro per million tokens (input, output). Estimates: the cap protects, it is not an invoice. */
const PRICES: Record<string, [number, number]> = {
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4o-transcribe': [2.5, 10],
  'gpt-4o-transcribe-diarize': [2.5, 10],
};
const WEB_SEARCH_EURO = 0.03;
const TRANSCRIBE_EURO_PER_MINUTE = 0.006;
/** Live segments are recorded at 32 kbit/s: bytes → minutes for a transcription without token usage. */
const AUDIO_BYTES_PER_MINUTE = (32000 / 8) * 60;

export const romeMonth = (d = new Date()) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 7);

export function aiCap(env: Env) {
  const v = Number(env.AI_TETTO_EURO);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function estimate(u: Usage) {
  const [pin, pout] = PRICES[u.model] || PRICES['gpt-4.1'];
  const t = u.usage || {};
  const input = Number(t.input_tokens ?? t.prompt_tokens) || 0,
    output = Number(t.output_tokens ?? t.completion_tokens) || 0;
  let euro = (input * pin + output * pout) / 1_000_000;
  if (!input && !output && u.audioBytes)
    euro = (u.audioBytes / AUDIO_BYTES_PER_MINUTE) * TRANSCRIBE_EURO_PER_MINUTE;
  if (u.webSearch) euro += WEB_SEARCH_EURO;
  return Math.round(euro * 10000) / 10000;
}

export async function aiSpent(db: D1Database, month = romeMonth()) {
  const r = await db
    .prepare('SELECT euro, calls FROM ai_usage WHERE month=?')
    .bind(month)
    .first<{ euro: number; calls: number }>();
  return { euro: Math.round((r?.euro || 0) * 100) / 100, calls: r?.calls || 0 };
}

/** The meter that lib/openai.ts calls before and after every request; none without a database. */
export function meterFor(env: Env, now = () => new Date()): Meter | undefined {
  const db = env.DB;
  if (!db) return undefined;
  return {
    async before() {
      const cap = aiCap(env);
      if (cap === null) return;
      const { euro } = await aiSpent(db, romeMonth(now()));
      if (euro >= cap)
        throw new AiBudgetError(
          `Hai raggiunto il tetto mensile dell’IA (${cap.toFixed(2).replace('.', ',')} €). Riparte il 1° del mese; archivio, portale e registrazioni funzionano lo stesso.`,
        );
    },
    async after(u) {
      const euro = estimate(u);
      await db
        .prepare(
          'INSERT INTO ai_usage(month,euro,calls,updated) VALUES(?,?,1,?) ON CONFLICT(month) DO UPDATE SET euro=euro+excluded.euro, calls=calls+1, updated=excluded.updated',
        )
        .bind(romeMonth(now()), euro, now().toISOString())
        .run();
    },
  };
}
