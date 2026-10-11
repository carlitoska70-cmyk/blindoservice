import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldLimits,
  normalizeRecognition,
  validDate,
  signatureMatches,
  recognitionRequest,
  handleRecognition,
  recognitionLimit,
} from '../lib/document-recognition.ts';
const categories = ['Titoli e SCIA', 'Igiene e HACCP', 'Altro'];
const pdf = new TextEncoder().encode('%PDF-1.4\nTest fixture');
function output() {
  return {
    quality: 'leggibile',
    warnings: [],
    fields: Object.fromEntries(
      Object.keys(fieldLimits).map(key => [
        key,
        {
          value: key === 'title' ? 'SCIA somministrazione' : key === 'category' ? 'Titoli e SCIA' : null,
          confidence: ['title', 'category'].includes(key) ? 'alta' : 'non_rilevato',
          evidence: ['title', 'category'].includes(key) ? 'SCIA per somministrazione' : '',
          page: null,
        },
      ]),
    ),
  };
}
function req(body = { fileId: 'file-1' }, headers = {}) {
  return new Request('https://app.example/api/documents/recognize', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function deps(overrides = {}) {
  let calls = 0,
    scope = null,
    payload = null;
  return {
    categories,
    authorize: async () => ({ userId: 'owner-1' }),
    apiKey: () => 'test-key-never-real',
    loadFile: async (id, owner) => {
      scope = { id, owner };
      return { mime: 'application/pdf', size: pdf.length, arrayBuffer: async () => pdf.buffer };
    },
    rate: async () => {},
    fetcher: async (url, options) => {
      calls++;
      payload = JSON.parse(options.body);
      assert.equal(url, 'https://api.openai.com/v1/responses');
      return Response.json({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
      });
    },
    ...overrides,
    get calls() {
      return calls;
    },
    get scope() {
      return scope;
    },
    get payload() {
      return payload;
    },
  };
}
test('PDF recognition is scoped to authenticated owner, structured and not stored by API', async () => {
  const d = deps();
  const r = await handleRecognition(req(), d);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.fileId, 'file-1');
  assert.equal(body.recognition.fields.category.value, 'Titoli e SCIA');
  assert.deepEqual(d.scope, { id: 'file-1', owner: 'owner-1' });
  assert.equal(d.payload.store, false);
  assert.equal(d.payload.text.format.strict, true);
  assert.equal(d.payload.input[0].content[1].type, 'input_file');
  assert.equal(d.calls, 1);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
});
test('image request uses image input and recovers original bytes', () => {
  const bytes = new Uint8Array(30001).map((_, i) => i % 256);
  const r = recognitionRequest(bytes, 'image/png', categories);
  const input = r.input[0].content[1];
  assert.equal(input.type, 'input_image');
  assert.deepEqual(new Uint8Array(Buffer.from(input.image_url.split(',')[1], 'base64')), bytes);
});
test('authentication and origin checks prevent model calls', async () => {
  const d = deps({ authorize: async () => null });
  assert.equal((await handleRecognition(req(), d)).status, 401);
  assert.equal(d.calls, 0);
  const e = deps();
  assert.equal((await handleRecognition(req(undefined, { origin: 'https://other.example' }), e)).status, 403);
  assert.equal(e.calls, 0);
});
test('another owner file and missing file produce 404 without model calls', async () => {
  const d = deps({
    loadFile: async (id, owner) =>
      owner === 'someone-else'
        ? { mime: 'application/pdf', size: pdf.length, arrayBuffer: async () => pdf.buffer }
        : null,
  });
  assert.equal((await handleRecognition(req(), d)).status, 404);
  assert.equal(d.calls, 0);
});
test('missing key gives actionable error and no model call', async () => {
  const d = deps({ apiKey: () => undefined });
  const r = await handleRecognition(req(), d);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /OPENAI_API_KEY/);
  assert.equal(d.calls, 0);
});
test('request size, schema and arbitrary URLs are rejected', async () => {
  const d = deps();
  assert.equal((await handleRecognition(req('x'.repeat(5000)), d)).status, 413);
  assert.equal((await handleRecognition(req({ fileId: 'x', url: 'https://evil.example' }), d)).status, 400);
  assert.equal((await handleRecognition(req({ fileId: '' }), d)).status, 400);
  assert.equal(d.calls, 0);
});
test('oversized, wrong MIME and spoofed files do not reach OpenAI', async () => {
  for (const [mime, size, bytes, status] of [
    ['audio/webm', pdf.length, pdf, 415],
    ['application/pdf', recognitionLimit + 1, pdf, 413],
    ['image/png', pdf.length, pdf, 415],
  ]) {
    const d = deps({ loadFile: async () => ({ mime, size, arrayBuffer: async () => bytes.buffer }) });
    assert.equal((await handleRecognition(req(), d)).status, status);
    assert.equal(d.calls, 0);
  }
});
test('per-owner quota prevents model calls', async () => {
  const d = deps({
    rate: async () => {
      throw new Error('Troppe richieste');
    },
  });
  assert.equal((await handleRecognition(req(), d)).status, 429);
  assert.equal(d.calls, 0);
});
test('dates must really exist and be complete', () => {
  assert.ok(validDate('2024-02-29'));
  for (const date of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026', ''])
    assert.equal(validDate(date), false);
  const raw = output();
  raw.fields.expires = {
    value: '2026-02-31',
    confidence: 'alta',
    evidence: 'scadenza 31 febbraio 2026',
    page: 1,
  };
  assert.equal(normalizeRecognition(raw, categories).fields.expires.value, null);
});
test('absent evidence and unknown categories cannot fill fields', () => {
  const raw = output();
  raw.fields.vat = { value: '12345678901', confidence: 'alta', evidence: '', page: 1 };
  raw.fields.category.value = 'Categoria inventata';
  const result = normalizeRecognition(raw, categories);
  assert.equal(result.fields.vat.value, null);
  assert.equal(result.fields.category.value, null);
  assert.equal(result.fields.expires.value, null);
});
test('uncertainty and supporting excerpts remain visible', () => {
  const raw = output();
  raw.fields.issuer = { value: 'Comune', confidence: 'bassa', evidence: 'Com...ne', page: 2 };
  const r = normalizeRecognition(raw, categories);
  assert.equal(r.fields.issuer.confidence, 'bassa');
  assert.equal(r.fields.issuer.page, 2);
  assert.equal(r.fields.issuer.evidence, 'Com...ne');
});
test('unreadable documents do not generate populated fields', () => {
  const raw = output();
  raw.quality = 'illeggibile';
  const r = normalizeRecognition(raw, categories);
  for (const f of Object.values(r.fields)) assert.equal(f.value, null);
});
test('refusals and incomplete output do not become document data', async () => {
  for (const [response, status] of [
    [{ status: 'incomplete', output: [] }, 502],
    [{ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }, 422],
  ]) {
    const d = deps({ fetcher: async () => Response.json(response) });
    assert.equal((await handleRecognition(req(), d)).status, status);
  }
});
test('invalid model JSON and structure fail without persisting a document', async () => {
  for (const text of ['not-json', '{}']) {
    const d = deps({
      fetcher: async () =>
        Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] }),
    });
    const r = await handleRecognition(req(), d);
    assert.ok(r.status >= 400);
    assert.equal((await r.json()).recognition, undefined);
  }
});
test('upstream errors and timeout expose no API key or raw upstream body', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const d = deps({ fetcher: async () => new Response('sensitive upstream detail', { status }) });
    const r = await handleRecognition(req(), d);
    assert.equal(r.status, 502);
    assert.doesNotMatch(await r.text(), /sensitive|test-key/);
  }
  const d = deps({
    fetcher: async () => {
      throw new Error('network');
    },
  });
  assert.equal((await handleRecognition(req(), d)).status, 504);
});
test('file magic accepts only supported document formats', () => {
  assert.ok(signatureMatches(pdf, 'application/pdf'));
  assert.ok(signatureMatches(new Uint8Array([255, 216, 255]), 'image/jpeg'));
  assert.ok(signatureMatches(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'));
  assert.ok(signatureMatches(new TextEncoder().encode('RIFF0000WEBP'), 'image/webp'));
  assert.equal(signatureMatches(pdf, 'image/jpeg'), false);
});
