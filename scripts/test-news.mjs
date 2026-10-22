import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(process.cwd(), '.test-live-'));
writeFileSync(
  join(dir, 'news.mjs'),
  ts.transpileModule(readFileSync('lib/news.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const { allowedUrl, parseNews } = await import(pathToFileURL(join(dir, 'news.mjs')).href);
rmSync(dir, { recursive: true, force: true });

test('only association and official domains are allowed', () => {
  assert(allowedUrl('https://www.fipe.it/comunicazione/news/x.html'));
  assert(allowedUrl('https://www.comune.palermo.it/ordinanze/1'));
  assert(allowedUrl('https://gurs.regione.sicilia.it/x'));
  assert(!allowedUrl('https://fipe.it.evil.com/x'));
  assert(!allowedUrl('https://www.ilblogdelbar.it/fipe'));
  assert(!allowedUrl('javascript:alert(1)'));
});

test('parseNews keeps valid items, drops others and duplicates', () => {
  const item = (url, extra = {}) => ({
    titolo: 'Nuove regole dehors',
    fonte: 'Comune di Palermo',
    url,
    sintesi: 'x',
    ...extra,
  });
  const { items, discarded } = parseNews(
    {
      notizie: [
        item('https://www.comune.palermo.it/a?utm=1'),
        item('https://www.comune.palermo.it/a'),
        item('https://www.notizie-false.com/a'),
        { titolo: 'x' },
        item('https://www.fipe.it/b', { rilevanza: 'urgentissima', scadenza: '31/12/2026' }),
      ],
    },
    new Set(['https://www.fipe.it/old']),
  );
  assert.deepEqual(
    items.map(i => i.url),
    ['https://www.comune.palermo.it/a?utm=1', 'https://www.fipe.it/b'],
  );
  assert.equal(items[1].rilevanza, 'media');
  assert.equal(items[1].scadenza, '');
  assert.equal(discarded, 2);
  assert.equal(
    parseNews({ notizie: [item('https://www.fipe.it/old')] }, new Set(['https://www.fipe.it/old'])).items
      .length,
    0,
  );
});
