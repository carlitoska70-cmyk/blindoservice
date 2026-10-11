import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const dir = mkdtempSync(join(tmpdir(), 'presidio-reminders-'));
const out = join(dir, 'reminders.mjs');
writeFileSync(
  out,
  ts.transpileModule(readFileSync('lib/reminders.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const { dueItems, notifiable, reminderText, romeToday } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const doc = (id, expires, extra = {}) => ({ id, kind: 'document', data: { title: id, expires, ...extra } });
const task = (id, due, done = false) => ({ id, kind: 'task', data: { title: id, due, done } });
const today = '2026-10-12'; // a Monday

test('due items: window, archive, done and missing dates', () => {
  const items = dueItems(
    [
      doc('in30', '2026-11-11'),
      doc('in31', '2026-11-12'),
      doc('late', '2026-10-01'),
      doc('archived', '2026-10-13', { archivedAt: '2026-10-01T00:00:00Z' }),
      doc('nodate', ''),
      task('t1', '2026-10-13'),
      task('t-done', '2026-10-13', true),
      task('t-far', '2026-10-30'),
    ],
    today,
  );
  assert.deepEqual(
    items.map(x => [x.id, x.days]),
    [
      ['late', -11],
      ['t1', 1],
      ['in30', 30],
    ],
  );
});

test('notifiable: milestones, weekly overdue nudge on Mondays', () => {
  const items = dueItems(
    [doc('d30', '2026-11-11'), doc('d29', '2026-11-10'), doc('late', '2026-10-01')],
    today,
  );
  assert.deepEqual(
    notifiable(items, today).map(x => x.id),
    ['late', 'd30'],
  );
  assert.deepEqual(notifiable(dueItems([doc('late', '2026-10-01')], '2026-10-13'), '2026-10-13'), []);
});

test('message text and Rome date', () => {
  const text = reminderText('Bar Test', dueItems([doc('SCIA', '2026-10-12')], today), 'https://x.test');
  assert.match(text, /SCIA — oggi/);
  assert.match(text, /https:\/\/x\.test/);
  assert.equal(romeToday(new Date('2026-10-11T23:30:00Z')), '2026-10-12');
});
