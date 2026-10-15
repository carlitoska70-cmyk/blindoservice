import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(tmpdir(), 'presidio-pdf-'));
const out = join(dir, 'text-pdf.mjs');
writeFileSync(
  out,
  ts.transpileModule(readFileSync('lib/text-pdf.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const { textPdf } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const latin1 = bytes => Buffer.from(bytes).toString('latin1');

test('valid structure: header, xref offsets, trailer', () => {
  const pdf = latin1(
    textPdf([
      { type: 'title', text: 'Rapporto' },
      { type: 'p', text: 'Testo (con parentesi) e \\ barra.' },
    ]),
  );
  assert(pdf.startsWith('%PDF-1.4'));
  assert(pdf.trimEnd().endsWith('%%EOF'));
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(pdf.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(pdf, /\(Testo \\\(con parentesi\\\) e \\\\ barra\.\) Tj/);
});

test('Italian accents and quotes in WinAnsi, unknown chars replaced', () => {
  const bytes = textPdf([{ type: 'p', text: 'Agibilità è già “ok” – 10€ 🙂' }]);
  const pdf = latin1(bytes);
  assert(pdf.includes('Agibilit\xe0 \xe8 gi\xe0 \x93ok\x94 \x96 10\x80 ?'));
});

test('long content paginates with page numbers', () => {
  const blocks = Array.from({ length: 120 }, (_, i) => ({ type: 'p', text: `Paragrafo ${i} `.repeat(12) }));
  const pdf = latin1(textPdf(blocks, 'Blindo Service'));
  const count = Number(pdf.match(/\/Count (\d+)/)[1]);
  assert(count > 3);
  assert(pdf.includes(`Pagina ${count} di ${count}`));
  assert(pdf.includes('Blindo Service'));
});
