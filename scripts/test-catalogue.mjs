import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectionCatalogue as items, catalogueSources as sources } from '../lib/inspection-catalogue.ts';
import {
  automaticCatalogueProposal,
  catalogueMatches,
  catalogLinks,
  withCatalogLinks,
  itemStatus,
  documentIssues,
  prepareCatalogLink,
} from '../lib/catalogue-matching.ts';
test('catalogue IDs and official source references are complete and unique', () => {
  assert.ok(items.length >= 85);
  assert.equal(new Set(items.map(c => c.id)).size, items.length);
  for (const c of items) {
    assert.ok(c.title && c.condition && c.territory && c.checkedOn);
    assert.ok(c.id.length <= 100);
    for (const id of c.sourceIds) assert.ok(sources.some(s => s.id === id));
  }
  for (const source of sources) assert.equal(new URL(source.url).protocol, 'https:');
});
test('specific recognized documents obtain a single automatic proposal', () => {
  for (const [title, id] of [
    ['Visura camerale ordinaria', 'visura'],
    ['Manuale HACCP', 'haccp'],
    ['Attestato HACCP', 'formazione-alimenti'],
    ['SCIA antincendio', 'scia-incendi'],
    ['Dichiarazione di conformità impianto gas', 'gas'],
    ['Registro allergeni', 'allergeni'],
  ]) {
    const data = automaticCatalogueProposal({ title }, items);
    assert.equal(data.catalogId, 'is26-' + id, title);
    assert.equal(data.reviewed, undefined);
  }
});
test('ambiguous titles are suggested but never automatically assigned', () => {
  const data = { title: 'Conformità impianto elettrico e conformità impianto gas' };
  assert.ok(catalogueMatches(data, items).length >= 2);
  assert.equal(automaticCatalogueProposal(data, items), data);
});
test('filename, notes, broad category and illegible scans cannot force a match', () => {
  for (const data of [
    { fileName: 'manuale-haccp.pdf', notes: 'manuale haccp', category: 'Igiene' },
    { title: 'documento' },
    { title: 'Manuale HACCP', recognition: { quality: 'illeggibile' } },
    { title: 'Richiesta SCIA antincendio' },
    { title: 'Bozza manuale HACCP' },
  ])
    assert.equal(automaticCatalogueProposal(data, items), data);
});
test('a manually selected or dismissed proposal is never overwritten', () => {
  for (const data of [
    { title: 'Manuale HACCP', catalogId: 'old-id' },
    { title: 'Manuale HACCP', catalogMatchingDismissed: true },
    { title: 'Manuale HACCP', catalogIds: ['existing'] },
  ])
    assert.equal(automaticCatalogueProposal(data, items), data);
});
test('many-to-many links preserve primary legacy reference and all original fields', () => {
  const original = {
    title: 'Test',
    catalogId: 'old',
    fileId: 'original',
    recognition: { quality: 'parziale' },
    notes: 'Annotazioni',
  };
  const linked = prepareCatalogLink(original, 'is26-haccp', true);
  assert.deepEqual(catalogLinks(linked), ['old', 'is26-haccp']);
  assert.equal(linked.fileId, 'original');
  assert.deepEqual(linked.recognition, original.recognition);
  assert.deepEqual(catalogLinks(prepareCatalogLink(linked, 'old', false)), ['is26-haccp']);
  assert.equal(original.catalogId, 'old');
  assert.deepEqual(catalogLinks(prepareCatalogLink(linked, 'is26-haccp', true)), ['old', 'is26-haccp']);
  assert.deepEqual(catalogLinks(withCatalogLinks(linked, [])), []);
});
test('absence is not a missing obligation until applicability is recorded', () => {
  const item = items[0];
  assert.equal(itemStatus(item, []).state, 'Senza originale');
  const requirement = {
    kind: 'requirement',
    updated: '2026-09-20',
    data: { catalogId: item.id, status: 'Applicabile' },
  };
  assert.equal(itemStatus(item, [requirement]).state, 'Originale da reperire');
  const newer = {
    ...requirement,
    updated: '2026-09-21',
    data: { ...requirement.data, status: 'Non applicabile' },
  };
  assert.equal(itemStatus(item, [requirement, newer]).state, 'Escluso dal responsabile');
});
test('a metadata-only card does not cover a required original; secondary links count', () => {
  const item = items[0],
    r = { kind: 'requirement', data: { catalogId: item.id, status: 'Applicabile' } };
  const d = {
    kind: 'document',
    data: { catalogId: 'other', catalogIds: [item.id], reviewed: true, reviewer: 'Tecnico' },
  };
  assert.equal(itemStatus(item, [r, d]).state, 'Originale da reperire');
  assert.equal(itemStatus(item, [r, { ...d, data: { ...d.data, fileId: 'file' } }]).state, 'File presenti');
});
test('expired, unreviewed and mismatched originals require review independently of links', () => {
  assert.deepEqual(
    documentIssues(
      { fileId: 'f', reviewed: true, reviewer: 'A', expires: '2026-09-20', vat: '222', address: 'Via B' },
      { vat: '111', address: 'Via A' },
      '2026-09-21',
    ),
    ['Data di scadenza superata', 'Partita IVA diversa dal profilo', 'Sede da confrontare con il profilo'],
  );
  assert.deepEqual(
    documentIssues(
      { fileId: 'f', reviewed: true, reviewer: 'A', vat: 'IT123' },
      { vat: '123' },
      '2026-09-21',
    ),
    [],
  );
  assert.ok(
    documentIssues({ fileId: 'f', reviewed: true, reviewer: '' }).includes('Verifica umana da annotare'),
  );
});
