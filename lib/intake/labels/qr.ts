import QRCode from "qrcode";
import { qrUrl } from "@/lib/intake/codes";

// QR codes on labels and tags. Each holds a stable /q/<CODE> address in upper
// case (QR alphanumeric mode keeps the code small), never an image URL.

/** What a card's or bag's QR holds: qrUrl() from lib/intake/codes.ts. */
export function labelQrData(code: string): string {
  return qrUrl(code);
}

export type QrMatrix = { size: number; dark: (x: number, y: number) => boolean };

const cache = new Map<string, QrMatrix>();

/** The code's modules (error correction M), without the quiet zone. */
export function qrMatrix(data: string): QrMatrix {
  const hit = cache.get(data);
  if (hit) return hit;
  const { modules } = QRCode.create(data, { errorCorrectionLevel: "M" });
  const m: QrMatrix = { size: modules.size, dark: (x, y) => !!modules.get(y, x) };
  if (cache.size > 500) cache.clear();
  cache.set(data, m);
  return m;
}

/**
 * The dark modules as one path in module units (each row's runs merged into
 * rectangles), for SVG and for pdf-lib's drawSvgPath.
 */
export function qrPath(m: QrMatrix): string {
  let d = "";
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark(x, y)) { x++; continue; }
      let end = x;
      while (end < m.size && m.dark(end, y)) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  }
  return d;
}
