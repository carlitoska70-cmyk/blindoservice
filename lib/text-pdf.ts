// Small text-only PDF writer (A4, Helvetica, WinAnsi) for archived reports.
// No dependencies, runs in the Worker. Italian accents and typographic quotes supported.

export type Block =
  | { type: 'title' | 'h' | 'p' | 'meta' | 'quote'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'space' };

// Helvetica advance widths (1/1000 em) for ASCII 32..126.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Unicode → WinAnsi (cp1252) for characters outside Latin-1 that reports commonly use.
const CP1252: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  Œ: 0x8c,
  œ: 0x9c,
};
function code(ch: string) {
  if (CP1252[ch]) return CP1252[ch];
  const c = ch.charCodeAt(0);
  return c >= 32 && c <= 255 && !(c >= 127 && c < 160) ? c : 63; // '?'
}
function width(ch: string, size: number, bold: boolean) {
  const base = ch.normalize('NFD')[0] || ch;
  const c = base.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? W[c - 32] : 556;
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}
function wrap(text: string, size: number, bold: boolean, max: number) {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '',
      lw = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const ww = [...word].reduce((t, ch) => t + width(ch, size, bold), 0);
      const sw = width(' ', size, bold);
      if (line && lw + sw + ww > max) {
        lines.push(line);
        line = word;
        lw = ww;
      } else {
        line = line ? line + ' ' + word : word;
        lw += (line === word ? 0 : sw) + ww;
      }
      // Hard-break words longer than a line (URLs, hashes).
      while (lw > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && [...line.slice(0, cut)].reduce((t, ch) => t + width(ch, size, bold), 0) > max)
          cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
        lw = [...line].reduce((t, ch) => t + width(ch, size, bold), 0);
      }
    }
    lines.push(line);
  }
  return lines;
}
const esc = (s: string) =>
  [...s]
    .map(ch => {
      const c = code(ch);
      if (c === 0x28 || c === 0x29 || c === 0x5c) return '\\' + String.fromCharCode(c);
      return String.fromCharCode(c);
    })
    .join('');

const STYLE = {
  title: { size: 18, bold: true, before: 0, after: 8, indent: 0, color: '0.07 0.14 0.24' },
  h: { size: 12.5, bold: true, before: 12, after: 4, indent: 0, color: '0.07 0.14 0.24' },
  p: { size: 10, bold: false, before: 2, after: 2, indent: 0, color: '0.09 0.14 0.24' },
  meta: { size: 8.5, bold: false, before: 1, after: 1, indent: 0, color: '0.36 0.42 0.51' },
  quote: { size: 9.5, bold: false, before: 2, after: 2, indent: 14, color: '0.25 0.3 0.4' },
  bullet: { size: 10, bold: false, before: 1, after: 1, indent: 12, color: '0.09 0.14 0.24' },
};

export function textPdf(blocks: Block[], footer = '') {
  const A4 = [595.28, 841.89],
    margin = 56,
    maxWidth = A4[0] - margin * 2;
  const pages: string[][] = [[]];
  let y = A4[1] - margin;
  const newPage = () => {
    pages.push([]);
    y = A4[1] - margin;
  };
  for (const b of blocks) {
    if (b.type === 'space') {
      y -= 8;
      continue;
    }
    const st = STYLE[b.type];
    const lead = st.size * 1.35;
    const prefix = b.type === 'bullet' ? '• ' : '';
    const lines = wrap(prefix + b.text, st.size, st.bold, maxWidth - st.indent);
    y -= st.before;
    // Keep headings with at least two following lines.
    if (b.type === 'h' && y - lead * 3 < margin) newPage();
    for (const [i, line] of lines.entries()) {
      if (y - lead < margin) newPage();
      y -= lead;
      const x = margin + st.indent + (b.type === 'bullet' && i > 0 ? width('•', st.size, false) + 3 : 0);
      pages[pages.length - 1].push(
        `BT ${st.color} rg /${st.bold ? 'F2' : 'F1'} ${st.size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(line)}) Tj ET`,
      );
    }
    y -= st.after;
  }
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((ops, i) => {
    const foot = `BT 0.5 0.55 0.62 rg /F1 7.5 Tf ${margin} 30 Td (${esc(
      (footer ? footer + ' · ' : '') + `Pagina ${i + 1} di ${pages.length}`,
    )}) Tj ET`;
    const stream = [...ops, foot].join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every char is a single byte (WinAnsi / ASCII), so string length = byte offset.
  return Uint8Array.from(out, ch => ch.charCodeAt(0) & 0xff);
}
