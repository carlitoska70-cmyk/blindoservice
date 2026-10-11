import qrcode from 'qrcode-generator';

/** SVG markup of a QR code (error correction M) that scales to its container. */
export function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}
