import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jpegPagesPdf } from '../lib/photo-pdf.ts';
test('multiple photos become pages in order with distinct images and correct xref', () => {
  const pages = [
    { jpeg: new Uint8Array([255, 216, 255, 1, 255, 217]), width: 1200, height: 1600 },
    { jpeg: new Uint8Array([255, 216, 255, 2, 255, 217]), width: 1800, height: 1200 },
  ];
  const bytes = jpegPagesPdf(pages),
    text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /\/Kids \[3 0 R 6 0 R\] \/Count 2/);
  assert.match(text, /\/Photo 4 0 R/);
  assert.match(text, /\/Photo 7 0 R/);
  assert.match(text, /\/MediaBox \[0 0 842 561.333\]/);
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(xref, xref + 4)), 'xref');
  for (const match of text.matchAll(/(\d{10}) 00000 n/g)) {
    assert.match(new TextDecoder().decode(bytes.slice(Number(match[1]), Number(match[1]) + 9)), /^\d+ 0 obj/);
  }
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
});
test('empty or invalid photo groups cannot produce a PDF', () => {
  assert.throws(() => jpegPagesPdf([]));
  assert.throws(() => jpegPagesPdf([{ jpeg: new Uint8Array([0]), width: 1, height: 1 }]));
});
test('thirty-page PDF uses correct object count and page references', () => {
  const pdf = new TextDecoder().decode(
    jpegPagesPdf(
      Array.from({ length: 30 }, () => ({
        jpeg: new Uint8Array([255, 216, 255, 217]),
        width: 100,
        height: 200,
      })),
    ),
  );
  assert.match(pdf, /\/Count 30/);
  assert.match(pdf, /\/Size 93/);
  assert.match(pdf, /90 0 R\] \/Count 30/);
});
