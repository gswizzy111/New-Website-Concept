import * as fontkitModule from "@pdf-lib/fontkit";
import { PDFDocument, PrintScaling, StandardFonts, rgb, setCharacterSpacing, type PDFFont, type PDFPage } from "pdf-lib";
import display800 from "./fonts/display800";
import display900 from "./fonts/display900";
import body400 from "./fonts/body400";
import body700 from "./fonts/body700";
import body800 from "./fonts/body800";
import mono600 from "./fonts/mono600";
import { layoutBagLabels } from "./layout";
import { qrMatrix, qrPath } from "./qr";
import type { FontRole, LabelBag, LabelColor, LabelPage, LabelStock } from "./types";

// Draws laid-out label pages (layout.ts) as a PDF: one page per label at the
// stock's exact size, pure black on white for the direct thermal printer
// (no navy, no grey), QR codes as vector modules, the brand fonts embedded.
// Server only (the fonts are large).

const FONT_DATA: Record<FontRole, string> = { display800, display900, body400, body700, body800, mono600 };

// The package's ES build only has a default export, its CommonJS build only
// named ones: take whichever this bundler gave us.
type FontkitArg = Parameters<PDFDocument["registerFontkit"]>[0];
const fontkit = ((fontkitModule as unknown as { default?: FontkitArg }).default ?? fontkitModule) as FontkitArg;

// If the brand fonts ever fail to embed, print with the PDF standard fonts
const FALLBACK: Record<FontRole, StandardFonts> = {
  display800: StandardFonts.HelveticaBold,
  display900: StandardFonts.HelveticaBold,
  body400: StandardFonts.Helvetica,
  body700: StandardFonts.HelveticaBold,
  body800: StandardFonts.HelveticaBold,
  mono600: StandardFonts.CourierBold,
};

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const color = (c: LabelColor) => (c === "paper" ? WHITE : BLACK);

/** A rounded rectangle as an SVG path, in label coordinates (y down). */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  const c = rr * 0.4477; // control point offset for a quarter circle
  return [
    `M${x + rr} ${y}`,
    `H${x + w - rr}`,
    `C${x + w - c} ${y} ${x + w} ${y + c} ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `C${x + w} ${y + h - c} ${x + w - c} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `C${x + c} ${y + h} ${x} ${y + h - c} ${x} ${y + h - rr}`,
    `V${y + rr}`,
    `C${x} ${y + c} ${x + c} ${y} ${x + rr} ${y}`,
    "Z",
  ].join("");
}

export type LabelPdfResult = { bytes: Uint8Array; brandFonts: boolean };

/** One PDF page per label page. */
export async function renderLabelPdf(pages: LabelPage[], meta: { title: string }): Promise<LabelPdfResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title);
  doc.setAuthor("The Card Doc");
  doc.setCreator("The Card Doc admin");
  doc.setProducer("The Card Doc admin");
  // Ask viewers to print at actual size, never "fit to page"
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);

  const used = new Set<FontRole>();
  for (const p of pages) for (const e of p.elements) if (e.kind === "text") used.add(e.font);

  const fonts = {} as Record<FontRole, PDFFont>;
  let brandFonts = true;
  try {
    for (const role of used) {
      fonts[role] = await doc.embedFont(Buffer.from(FONT_DATA[role], "base64"), {
        subset: true,
        // Draw each character as itself, so widths match the layout's metrics
        features: { liga: false, clig: false, calt: false, dlig: false, rlig: false },
      });
    }
  } catch (err) {
    console.error("Label fonts failed to embed; using the standard PDF fonts:", err);
    brandFonts = false;
    for (const role of used) fonts[role] = await doc.embedFont(FALLBACK[role]);
  }

  for (const p of pages) {
    const page = doc.addPage([p.width, p.height]);
    for (const e of p.elements) {
      if (e.kind === "rect") drawRect(page, e.x, e.y, e.w, e.h, e);
      else if (e.kind === "line") {
        page.drawLine({
          start: { x: e.x1, y: p.height - e.y1 },
          end: { x: e.x2, y: p.height - e.y2 },
          thickness: e.width,
          color: color(e.color),
          dashArray: e.dash,
        });
      } else if (e.kind === "qr") {
        const m = qrMatrix(e.data);
        page.drawSvgPath(qrPath(m), { x: e.x, y: p.height - e.y, scale: e.size / m.size, color: BLACK });
      } else {
        const font = fonts[e.font];
        let size = e.size;
        let t = e.text;
        if (!brandFonts) {
          t = winAnsiSafe(t, font);
          const w = font.widthOfTextAtSize(t, size) + Math.max(0, [...t].length - 1) * e.tracking;
          if (w > e.width + 0.5) size = (size * e.width) / w;
        }
        if (e.tracking) page.pushOperators(setCharacterSpacing(e.tracking));
        page.drawText(t, { x: e.x, y: p.height - e.y, size, font, color: color(e.color) });
        if (e.tracking) page.pushOperators(setCharacterSpacing(0));
      }
    }
  }
  return { bytes: await doc.save(), brandFonts };
}

function drawRect(page: PDFPage, x: number, y: number, w: number, h: number, e: { fill?: LabelColor; stroke?: LabelColor; strokeWidth?: number; radius?: number }) {
  const H = page.getHeight();
  if (e.fill) {
    if (e.radius) page.drawSvgPath(roundedRect(x, y, w, h, e.radius), { x: 0, y: H, color: color(e.fill) });
    else page.drawRectangle({ x, y: H - y - h, width: w, height: h, color: color(e.fill) });
  }
  if (e.stroke && e.strokeWidth) {
    // Stroke inside the box: the path runs along the middle of the stroke
    const sw = e.strokeWidth;
    page.drawSvgPath(roundedRect(x + sw / 2, y + sw / 2, w - sw, h - sw, Math.max(0, (e.radius ?? 0) - sw / 2)), {
      x: 0,
      y: H,
      borderColor: color(e.stroke),
      borderWidth: sw,
    });
  }
}

/** The standard fonts only draw WinAnsi: anything else becomes "?". */
function winAnsiSafe(t: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  return [...t].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

/** One label per bag (layoutBagLabels gives each bag exactly one page), in order, as one PDF. */
export function bagLabelsPdf(bags: LabelBag[], stock: LabelStock, title: string) {
  return renderLabelPdf(bags.flatMap((b) => layoutBagLabels(b, stock)), { title });
}
