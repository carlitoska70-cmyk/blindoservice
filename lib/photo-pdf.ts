export type PhotoPage = { jpeg: Uint8Array; width: number; height: number };
export function jpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  return jpegPagesPdf([{ jpeg, width, height }]);
}
export function jpegPagesPdf(pages: PhotoPage[]): Uint8Array {
  if (!pages.length) throw new Error('Aggiungi almeno una foto.');
  for (const { jpeg, width, height } of pages)
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      jpeg[0] !== 255 ||
      jpeg[1] !== 216
    )
      throw new Error('Fotografia non valida.');
  const encode = (s: string) => new TextEncoder().encode(s);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const offsets = [0];
  const push = (b: Uint8Array) => {
    chunks.push(b);
    size += b.length;
  };
  push(encode('%PDF-1.4\n'));
  function object(n: number, parts: Uint8Array[]) {
    offsets[n] = size;
    push(encode(n + ' 0 obj\n'));
    parts.forEach(push);
    push(encode('\nendobj\n'));
  }
  object(1, [encode('<< /Type /Catalog /Pages 2 0 R >>')]);
  object(2, [
    encode(
      `<< /Type /Pages /Kids [${pages.map((_, i) => 3 + i * 3 + ' 0 R').join(' ')}] /Count ${pages.length} >>`,
    ),
  ]);
  pages.forEach(({ jpeg, width, height }, i) => {
    const n = 3 + i * 3,
      pageWidth = width >= height ? 842 : 595,
      pageHeight = (pageWidth * height) / width;
    object(n, [
      encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight.toFixed(3)}] /Resources << /XObject << /Photo ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`,
      ),
    ]);
    object(n + 1, [
      encode(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      encode('\nendstream'),
    ]);
    const content = encode(`q ${pageWidth} 0 0 ${pageHeight.toFixed(3)} 0 0 cm /Photo Do Q\n`);
    object(n + 2, [encode(`<< /Length ${content.length} >>\nstream\n`), content, encode('endstream')]);
  });
  const xref = size;
  push(
    encode(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map(x => String(x).padStart(10, '0') + ' 00000 n \n')
          .join('') +
        `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
export function fileKind(file: { name: string; type: string }): 'pdf' | 'photo' | 'unsupported' {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return 'photo';
  return 'unsupported';
}
export async function documentPdf(file: File): Promise<File> {
  const kind = fileKind(file);
  if (kind === 'unsupported') throw new Error('Formato non supportato: usa PDF o fotografie.');
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error('Limite per singolo file: 20 MB. Dividi i file più grandi.');
  if (kind === 'pdf')
    return new File([file], file.name, { type: 'application/pdf', lastModified: file.lastModified });
  const page = await photoPage(file);
  return new File(
    [jpegPagesPdf([page]) as Uint8Array<ArrayBuffer>],
    file.name.replace(/\.[^.]+$/, '') + '.pdf',
    { type: 'application/pdf' },
  );
}
export async function photoPage(file: File): Promise<PhotoPage> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Massimo 20 MB per fotografia.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error(
        'Foto non leggibile da questo browser. Esporta HEIC in JPEG oppure scatta in formato compatibile.',
      );
    });
    const scale = Math.min(1, 3200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Conversione PDF non disponibile.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Conversione della foto non riuscita.'))),
        'image/jpeg',
        0.94,
      ),
    );
    const result = {
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
    canvas.width = canvas.height = 1;
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
