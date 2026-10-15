import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Transpile lib/live.ts and lib/text-pdf.ts side by side; zod resolves from node_modules.
const dir = mkdtempSync(join(process.cwd(), '.test-live-'));
for (const name of ['live', 'text-pdf'])
  writeFileSync(
    join(dir, name + '.mjs'),
    ts
      .transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace("from './text-pdf'", "from './text-pdf.mjs'"),
  );
const live = await import(pathToFileURL(join(dir, 'live.mjs')).href);
const { textPdf } = await import(pathToFileURL(join(dir, 'text-pdf.mjs')).href);
rmSync(dir, { recursive: true, force: true });

const transcript = `Buongiorno, polizia municipale, controllo sulla SCIA.
Mi faccia vedere la SCIA e la planimetria.
Se non me la fa vedere subito le chiudo il locale oggi stesso, ha capito?
Il dehors occupa più spazio di quello autorizzato.`;

test('hint: only real questions, unknown document ids dropped', () => {
  const ids = new Set(['d1']);
  assert.equal(live.parseHint({ question: null, answer: 'x' }, ids), null);
  assert.equal(live.parseHint({ question: 'Mi mostra la SCIA?', answer: '  ' }, ids), null);
  const h = live.parseHint(
    {
      question: 'Mi mostra la SCIA?',
      answer: 'Certo, è nel portale: cerchi “scia”.',
      documents: ['d1', 'inventato'],
      urgency: 'boh',
    },
    ids,
  );
  assert.deepEqual(h.documents, ['d1']);
  assert.equal(h.urgency, 'normale');
});

test('report: quotes must exist verbatim, unsupported violations downgraded', () => {
  const r = live.validateReport(
    {
      motivo: 'Verifica SCIA e dehors',
      sintesi: 'Controllo con contestazione sul dehors.',
      possibiliViolazioni: [
        {
          titolo: 'Minaccia di chiusura immediata',
          descrizione: 'L’agente prospetta la chiusura senza provvedimento.',
          citazione: 'se non me la fa vedere subito, le chiudo il locale oggi stesso',
          riferimento: 'da individuare con il legale',
          gravita: 'alta',
          verifica: 'Ascoltare la registrazione al minuto indicato.',
        },
        {
          titolo: 'Insulto',
          descrizione: 'Frase non presente',
          citazione: 'lei è un delinquente',
          gravita: 'alta',
        },
      ],
      puntiForza: [{ testo: 'SCIA presente', citazione: 'Mi faccia vedere la SCIA' }],
      puntiDeboli: [
        {
          testo: 'Dehors oltre l’autorizzato',
          citazione: 'occupa più spazio',
          rimedio: 'Verificare la concessione OSP',
        },
      ],
      azioni: ['Richiedere copia del verbale'],
    },
    transcript,
  );
  assert.equal(r.possibiliViolazioni[0].gravita, 'alta');
  assert.match(r.possibiliViolazioni[0].citazione, /chiudo il locale/);
  assert.equal(r.possibiliViolazioni[1].citazione, '');
  assert.equal(r.possibiliViolazioni[1].gravita, 'bassa');
  assert.equal(r.citazioniScartate, 1);
  assert.deepEqual(r.cronologia, []);
});

test('report PDF contains sections and SHA of the recording', () => {
  const r = live.validateReport(
    { motivo: 'Verifica', sintesi: 'Ok', azioni: ['Accesso agli atti'] },
    transcript,
  );
  const blocks = live.reportBlocks(r, {
    company: 'Caffè del Kassaro',
    authority: 'Polizia municipale',
    officers: 'Mario Rossi · targa AB123CD',
    started: '2026-10-15T09:00:00Z',
    ended: '2026-10-15T09:40:00Z',
    audioSha256: 'abc123',
    audioName: 'controllo.webm',
    segments: 12,
    model: 'gpt-4.1',
  });
  const pdf = Buffer.from(textPdf(blocks, 'Blindo Service')).toString('latin1');
  for (const s of [
    'Rapporto del controllo',
    'Motivo dell',
    'Azioni consigliate',
    'SHA-256 abc123',
    'Caff\xe8 del Kassaro',
  ])
    assert(pdf.includes(s), s);
});
