import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(process.cwd(), '.test-live-'));
for (const name of ['news', 'news-job', 'openai', 'notify'])
  writeFileSync(
    join(dir, name + '.mjs'),
    ts
      .transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(['"])(\.\/[a-z-]+)\1/g, "'$2.mjs'"),
  );
const { allowedUrl, parseNews } = await import(pathToFileURL(join(dir, 'news.mjs')).href);
const { newsWeek, newsDue } = await import(pathToFileURL(join(dir, 'news-job.mjs')).href);
rmSync(dir, { recursive: true, force: true });

test('news week starts on Monday at 08:00 in Rome, summer and winter time', () => {
  // Summer (UTC+2): Monday 20/10/2025 08:00 Rome = 06:00 UTC.
  assert.equal(newsWeek(new Date('2025-10-20T05:59:00Z')), '2025-10-13');
  assert.equal(newsWeek(new Date('2025-10-20T06:00:00Z')), '2025-10-20');
  assert.equal(newsWeek(new Date('2025-10-26T21:00:00Z')), '2025-10-20'); // Sunday night
  // Winter (UTC+1): Monday 27/10/2025 08:00 Rome = 07:00 UTC.
  assert.equal(newsWeek(new Date('2025-10-27T06:59:00Z')), '2025-10-20');
  assert.equal(newsWeek(new Date('2025-10-27T07:00:00Z')), '2025-10-27');
  // Sunday 23:30 UTC is already Monday 00:30 in Rome, still before 08:00.
  assert.equal(newsWeek(new Date('2025-12-28T23:30:00Z')), '2025-12-22');
});

test('newsDue: once per week, failed attempts retried after 6 hours', () => {
  const at = iso => new Date(iso);
  assert.equal(newsDue(at('2025-10-23T10:00:00Z'), null), true); // first run ever
  const ran = { lastRun: '2025-10-20T06:07:00Z', lastAttempt: '2025-10-20T06:07:00Z' };
  assert.equal(newsDue(at('2025-10-26T22:00:00Z'), ran), false);
  assert.equal(newsDue(at('2025-10-27T07:07:00Z'), ran), true);
  const failed = { ...ran, lastAttempt: '2025-10-27T07:07:00Z' };
  assert.equal(newsDue(at('2025-10-27T12:07:00Z'), failed), false);
  assert.equal(newsDue(at('2025-10-27T13:07:00Z'), failed), true);
});

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
