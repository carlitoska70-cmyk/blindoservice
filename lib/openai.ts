// Minimal OpenAI client for the Worker (fetch only). All user content is passed as
// data in `input`; behaviour is defined only by `instructions`.

import type { Meter } from './ai-budget';

export class AiError extends Error {}

/** OPENAI_BASE_URL is only for the end-to-end test server (local mock); production uses the default. */
export type Ai = {
  key: string;
  base?: string;
  /** Monthly spending cap (lib/ai-budget.ts). */ meter?: Meter;
};
const endpoint = (ai: Ai, path: string) => (ai.base || 'https://api.openai.com') + path;

export async function responsesJson<T = unknown>(
  ai: Ai,
  opts: {
    model: string;
    instructions: string;
    input: string;
    maxTokens?: number;
    timeoutMs?: number;
    /** Lets the model search the web (OpenAI web_search tool). */
    webSearch?: boolean;
    /** With webSearch: only these sites (bare hostnames, subdomains included). */
    allowedDomains?: string[];
  },
): Promise<T> {
  await ai.meter?.before();
  const r = await fetch(endpoint(ai, '/v1/responses'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ai.key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    body: JSON.stringify({
      model: opts.model,
      store: false,
      instructions: opts.instructions,
      input: opts.input,
      // JSON mode cannot be combined with tools: with web search the JSON is parsed from the text.
      ...(opts.webSearch
        ? {
            tools: [
              {
                type: 'web_search',
                ...(opts.allowedDomains?.length ? { filters: { allowed_domains: opts.allowedDomains } } : {}),
              },
            ],
          }
        : { text: { format: { type: 'json_object' } } }),
      max_output_tokens: opts.maxTokens ?? 2000,
    }),
  });
  if (!r.ok) throw new AiError('OpenAI ' + r.status);
  const result: any = await r.json();
  await ai.meter?.after({ model: opts.model, usage: result.usage, webSearch: opts.webSearch });
  const text = (result.output || [])
    .flatMap((x: any) => x.content || [])
    .filter((x: any) => x.type === 'output_text')
    .map((x: any) => x.text)
    .join('');
  try {
    const json = opts.webSearch ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) : text;
    return JSON.parse(json) as T;
  } catch {
    throw new AiError('Risposta non strutturata');
  }
}

export async function transcribe(
  ai: Ai,
  audio: Blob,
  name: string,
  opts: { model?: string; prompt?: string; timeoutMs?: number } = {},
) {
  await ai.meter?.before();
  const form = new FormData();
  form.append('file', audio, name);
  form.append('model', opts.model ?? 'gpt-4o-transcribe');
  form.append('language', 'it');
  form.append('response_format', 'json');
  if (opts.prompt) form.append('prompt', opts.prompt.slice(-800));
  const r = await fetch(endpoint(ai, '/v1/audio/transcriptions'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ai.key },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
  });
  if (!r.ok) throw new AiError('Trascrizione ' + r.status);
  const result: any = await r.json();
  await ai.meter?.after({
    model: opts.model ?? 'gpt-4o-transcribe',
    usage: result.usage,
    audioBytes: audio.size,
  });
  return String(result.text || '').trim();
}
