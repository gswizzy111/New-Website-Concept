import { qrMatrix } from "@/lib/intake/labels/qr";
import type { FontRole, LabelColor, LabelElement, LabelPage, LabelText } from "@/lib/intake/labels/types";

// A label page (lib/intake/labels) as a black-and-white PNG for the
// Katasymbol (Supvan T50M Pro family) printer: its phone app can't take a
// PDF, but it puts a picture from Photos on a label. The page is drawn the
// way label-preview.tsx draws it (same elements, the same fonts the PDF
// embeds), on a canvas exactly as many dots as the label holds (50 x 80 mm at
// 8 dots per mm = 400 x 640), then cut to pure black and white so the
// printer's own threshold changes nothing.
//
// The sizing and parsing helpers at the top are pure (unit-tested in
// tests/intake/label-image.test.ts); the drawing and sharing helpers below
// them need a browser and only run when called.

export const MM_PER_IN = 25.4;
export const PT_PER_IN = 72;

/** Supvan's T50 family prints 203 dpi, which its app treats as exactly 8 dots per mm. */
export const KATASYMBOL_DOTS_PER_MM = 8;
/** The 300 dpi models (T50 Plus+, T80 Pro+): 11.8 dots per mm in Supvan's apps. */
export const HIGH_RES_DOTS_PER_MM = 11.8;
/** The owner's labels, portrait as the Katasymbol app shows them: 50 mm wide, 80 mm tall. */
export const KATASYMBOL_LABEL_MM = { width: 50, height: 80 } as const;
/** Darker than this (0-255) prints black; the rest stays white. Half way, like the PDF's edges. */
export const BLACK_THRESHOLD = 128;

export type SizeMm = { width: number; height: number };
export type SizePx = { width: number; height: number };

/** Points (1/72 in) to millimetres. */
export function ptToMm(pt: number): number {
  return (pt / PT_PER_IN) * MM_PER_IN;
}

/** A length in printer dots (at least 1). */
export function mmToDots(mm: number, dotsPerMm: number = KATASYMBOL_DOTS_PER_MM): number {
  return Math.max(1, Math.round(mm * dotsPerMm));
}

/** A label's size in printer dots: 50 x 80 mm is 400 x 640 at 203 dpi, 590 x 944 at 300 dpi. */
export function labelPixelSize(size: SizeMm, dotsPerMm: number = KATASYMBOL_DOTS_PER_MM): SizePx {
  return { width: mmToDots(size.width, dotsPerMm), height: mmToDots(size.height, dotsPerMm) };
}

/** A laid-out page's own size in millimetres (its width and height are points). */
export function pageSizeMm(page: Pick<LabelPage, "width" | "height">): SizeMm {
  return { width: ptToMm(page.width), height: ptToMm(page.height) };
}

/** Whether a page is (within half a millimetre) the given label size. */
export function isPageSize(page: Pick<LabelPage, "width" | "height">, size: SizeMm): boolean {
  const mm = pageSizeMm(page);
  return Math.abs(mm.width - size.width) < 0.5 && Math.abs(mm.height - size.height) < 0.5;
}

export type Placement = {
  /** Image pixels per page point. */
  scale: number;
  /** Where the page's top-left corner lands on the image, in pixels. */
  offsetX: number;
  offsetY: number;
};

/**
 * Where a page goes on an image of another size: as large as fits (never
 * cropped), centered. A 50 x 80 mm page on a 50 x 80 mm image fills it
 * exactly; a 4 x 6 in bag label shrinks onto it with white above and below.
 */
export function placePage(pageW: number, pageH: number, imgW: number, imgH: number): Placement {
  if (!(pageW > 0) || !(pageH > 0)) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(imgW / pageW, imgH / pageH);
  return { scale, offsetX: (imgW - pageW * scale) / 2, offsetY: (imgH - pageH * scale) / 2 };
}

/**
 * A QR code snapped to whole pixels: every module the same number of dots
 * (so a scanner sees an even grid), centered in its box. `x`, `y`, `size`
 * are the box in image pixels; `modules` is the code's side (e.g. 33).
 */
export function qrPixelGrid(x: number, y: number, size: number, modules: number): { x: number; y: number; module: number } {
  const dots = Math.max(1, Math.floor(size / Math.max(1, modules)));
  const drawn = dots * modules;
  return { x: Math.round(x + (size - drawn) / 2), y: Math.round(y + (size - drawn) / 2), module: dots };
}

/**
 * RGBA pixels cut to pure black or white in place (transparent counts as
 * white paper). Returns how many pixels are black.
 */
export function thresholdToBlackWhite(data: Uint8ClampedArray, threshold: number = BLACK_THRESHOLD): number {
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Integer weights, so a grey of exactly the threshold stays white
    const a = data[i + 3];
    const lum = ((299 * data[i] + 587 * data[i + 1] + 114 * data[i + 2]) * a + 255000 * (255 - a)) / 255000;
    const v = lum < threshold ? 0 : 255;
    if (v === 0) dark++;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return dark;
}

// ---------------------------------------------------------------------------
// The label JSON our routes send (?format=json), whatever its shape

/** A page to print, with the name its picture is saved under (a Bag ID, "CLAMP-07"). */
export type NamedLabelPage = { name: string; page: LabelPage };

export function isLabelPage(v: unknown): v is LabelPage {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<LabelPage>;
  return typeof p.width === "number" && p.width > 0 && typeof p.height === "number" && p.height > 0 && Array.isArray(p.elements);
}

function nameOf(o: Record<string, unknown>): string | null {
  for (const k of ["code", "bagCode", "locationCode", "name", "label"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const loc = o.location;
  if (loc && typeof loc === "object") {
    const c = (loc as Record<string, unknown>).code;
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** One item of a list: a page, or { page | label | sign | labels: [...] } with a code or name. */
function pagesOfItem(item: unknown, fallback: string): NamedLabelPage[] {
  if (isLabelPage(item)) return [{ name: fallback, page: item }];
  if (!item || typeof item !== "object") return [];
  const o = item as Record<string, unknown>;
  const name = nameOf(o) ?? fallback;
  for (const k of ["page", "label", "sign"]) {
    if (isLabelPage(o[k])) return [{ name, page: o[k] as LabelPage }];
  }
  for (const k of ["labels", "pages"]) {
    const list = o[k];
    if (Array.isArray(list)) {
      const pages = list.filter(isLabelPage);
      return pages.map((page, i) => ({ name: pages.length > 1 ? `${name}-${i + 1}` : name, page }));
    }
  }
  return [];
}

/**
 * Every label page in a label route's JSON, in order, each with a name:
 * bag labels ({ bags: [{ bagCode, labels }] }), page lists
 * ({ pages | labels | signs | slots | locations: [{ code, page }] }), one sign
 * ({ page, code }) or a bare page or list of pages.
 */
export function labelPagesFromJson(body: unknown, baseName = "label"): NamedLabelPage[] {
  if (isLabelPage(body)) return [{ name: baseName, page: body }];
  const list: unknown[] | null = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? (() => {
          const o = body as Record<string, unknown>;
          for (const k of ["bags", "pages", "labels", "signs", "slots", "locations", "items"]) {
            if (Array.isArray(o[k])) return o[k] as unknown[];
          }
          return null;
        })()
      : null;
  if (!list) return body && typeof body === "object" ? pagesOfItem(body, baseName) : [];
  const out: NamedLabelPage[] = [];
  list.forEach((item, i) => out.push(...pagesOfItem(item, list.length > 1 ? `${baseName}-${i + 1}` : baseName)));
  return out;
}

/** A safe, unique PNG file name for a label: "CLAMP 07" → "CLAMP-07.png" ("CLAMP-07-2.png" when taken). */
export function labelImageFileName(name: string, taken: Set<string>): string {
  const base = name.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "label";
  let file = `${base}.png`;
  for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${base}-${n}.png`;
  taken.add(file.toLowerCase());
  return file;
}

/**
 * The address of a label route's JSON for the pictures: its PDF address with
 * ?format=json, plus `extra` (e.g. { stock: "50x80mm" }). Keeps the rest of
 * the query (bags, v).
 */
export function labelJsonUrl(pdfUrl: string, extra: Record<string, string> = {}): string {
  const u = new URL(pdfUrl, "https://label.invalid");
  u.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(extra)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.origin === "https://label.invalid" ? `${u.pathname}${u.search}` : u.toString();
}

// ---------------------------------------------------------------------------
// PNG resolution (pHYs), so apps that size pictures by dpi place it at 50 x 80 mm

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 as PNG chunks use it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The PNG with its resolution recorded (a pHYs chunk right after IHDR, any
 * old one dropped): `dotsPerMm` × 1000 pixels per metre. Not a PNG: returned
 * as is.
 */
export function withPngResolution(png: Uint8Array, dotsPerMm: number): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8); // signature + IHDR (length, type, data, crc)
  const ppm = Math.round(dotsPerMm * 1000);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Copy the other chunks, leaving out any pHYs already there
  const rest: Uint8Array[] = [];
  let at = ihdrEnd;
  while (at + 12 <= png.length) {
    const len = view.getUint32(at);
    const end = at + 12 + len;
    if (end > png.length) break;
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    if (type !== "pHYs") rest.push(png.subarray(at, end));
    at = end;
  }
  const total = ihdrEnd + chunk.length + rest.reduce((n, r) => n + r.length, 0);
  const out = new Uint8Array(total);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  let o = ihdrEnd + chunk.length;
  for (const r of rest) {
    out.set(r, o);
    o += r.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing (browser only)

// The fonts the PDF embeds (static instances, so widths match the layout),
// loaded only when a picture is made: they are large, and the PDF path and
// the on-screen preview never need them in the page.
const FONT_MODULES: Record<FontRole, () => Promise<{ default: string }>> = {
  display800: () => import("@/lib/intake/labels/fonts/display800"),
  display900: () => import("@/lib/intake/labels/fonts/display900"),
  body400: () => import("@/lib/intake/labels/fonts/body400"),
  body700: () => import("@/lib/intake/labels/fonts/body700"),
  body800: () => import("@/lib/intake/labels/fonts/body800"),
  mono600: () => import("@/lib/intake/labels/fonts/mono600"),
};

// If a font can't load, the browser's own close match (the width is still pinned to the layout's)
const FALLBACK_FONT: Record<FontRole, string> = {
  display800: "800 SIZE 'Arial Narrow', Arial, sans-serif",
  display900: "900 SIZE 'Arial Narrow', Arial, sans-serif",
  body400: "400 SIZE Arial, Helvetica, sans-serif",
  body700: "700 SIZE Arial, Helvetica, sans-serif",
  body800: "800 SIZE Arial, Helvetica, sans-serif",
  mono600: "600 SIZE 'Courier New', monospace",
};

const loadedFaces = new Map<FontRole, Promise<string | null>>();

function base64Bytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return buf;
}

/** Loads one label font into the page (once); its CSS family name, or null when it can't load. */
function loadFont(role: FontRole): Promise<string | null> {
  let p = loadedFaces.get(role);
  if (!p) {
    p = (async () => {
      if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return null;
      const mod = await FONT_MODULES[role]();
      const family = `CD Label ${role}`;
      const face = new FontFace(family, base64Bytes(mod.default));
      await face.load();
      document.fonts.add(face);
      return `"${family}"`;
    })().catch(() => null);
    loadedFaces.set(role, p);
  }
  return p;
}

/** The fonts a page's text uses, loaded: role → a canvas font string with "SIZE" to fill in. */
async function fontsFor(pages: LabelPage[]): Promise<Map<FontRole, string>> {
  const roles = new Set<FontRole>();
  for (const page of pages) for (const e of page.elements) if (e.kind === "text") roles.add(e.font);
  const out = new Map<FontRole, string>();
  await Promise.all(
    [...roles].map(async (role) => {
      const family = await loadFont(role);
      out.set(role, family ? `SIZE ${family}` : FALLBACK_FONT[role]);
    }),
  );
  return out;
}

const ink = (c: LabelColor) => (c === "paper" ? "#ffffff" : "#000000");

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, e: LabelText, font: string, X: (v: number) => number, Y: (v: number) => number, S: (v: number) => number) {
  ctx.font = font.replace("SIZE", `${S(e.size)}px`);
  ctx.fillStyle = ink(e.color);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (e.tracking) {
    // Letter-spaced: each character at its measured place plus the spacing so far
    const chars = Array.from(e.text);
    let prefix = "";
    chars.forEach((ch, i) => {
      ctx.fillText(ch, X(e.x) + ctx.measureText(prefix).width + S(e.tracking) * i, Y(e.y));
      prefix += ch;
    });
    return;
  }
  // Like the preview's textLength: the line is stretched to exactly its printed width
  const measured = ctx.measureText(e.text).width;
  const target = S(e.width);
  if (measured > 0 && target > 0 && Math.abs(measured - target) > 0.25) {
    ctx.save();
    ctx.translate(X(e.x), Y(e.y));
    ctx.scale(target / measured, 1);
    ctx.fillText(e.text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(e.text, X(e.x), Y(e.y));
  }
}

function drawElement(ctx: CanvasRenderingContext2D, e: LabelElement, fonts: Map<FontRole, string>, place: Placement) {
  const X = (v: number) => place.offsetX + v * place.scale;
  const Y = (v: number) => place.offsetY + v * place.scale;
  const S = (v: number) => v * place.scale;
  switch (e.kind) {
    case "rect": {
      // As the preview: the stroke sits inside the box
      const sw = e.stroke ? e.strokeWidth ?? 0 : 0;
      roundRectPath(ctx, X(e.x + sw / 2), Y(e.y + sw / 2), S(Math.max(0, e.w - sw)), S(Math.max(0, e.h - sw)), S(Math.max(0, (e.radius ?? 0) - sw / 2)));
      if (e.fill) {
        ctx.fillStyle = ink(e.fill);
        ctx.fill();
      }
      if (e.stroke && sw > 0) {
        ctx.strokeStyle = ink(e.stroke);
        ctx.lineWidth = S(sw);
        ctx.stroke();
      }
      return;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(X(e.x1), Y(e.y1));
      ctx.lineTo(X(e.x2), Y(e.y2));
      ctx.strokeStyle = ink(e.color);
      ctx.lineWidth = S(e.width);
      ctx.lineCap = "butt";
      ctx.setLineDash(e.dash ? e.dash.map(S) : []);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    case "qr": {
      const m = qrMatrix(e.data);
      const g = qrPixelGrid(X(e.x), Y(e.y), S(e.size), m.size);
      ctx.fillStyle = "#000000";
      for (let r = 0; r < m.size; r++) {
        let c = 0;
        while (c < m.size) {
          if (!m.dark(c, r)) {
            c++;
            continue;
          }
          let end = c;
          while (end < m.size && m.dark(end, r)) end++;
          ctx.fillRect(g.x + c * g.module, g.y + r * g.module, (end - c) * g.module, g.module);
          c = end;
        }
      }
      return;
    }
    case "text":
      drawText(ctx, e, fonts.get(e.font) ?? FALLBACK_FONT[e.font], X, Y, S);
      return;
  }
}

export type LabelImageOptions = {
  /** Printer dots per mm: 8 (203 dpi, the default) or 11.8 (300 dpi). */
  dotsPerMm?: number;
  /** The label the picture is for (default 50 x 80 mm); "page" keeps the page's own size. */
  size?: SizeMm | "page";
  threshold?: number;
};

/** Draws a page on a canvas at the printer's dots, pure black and white. */
export async function renderLabelCanvas(page: LabelPage, opts: LabelImageOptions = {}): Promise<HTMLCanvasElement> {
  const dotsPerMm = opts.dotsPerMm ?? KATASYMBOL_DOTS_PER_MM;
  const size = opts.size === "page" ? pageSizeMm(page) : opts.size ?? KATASYMBOL_LABEL_MM;
  const px = labelPixelSize(size, dotsPerMm);
  const canvas = document.createElement("canvas");
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't draw the label.");
  const fonts = await fontsFor([page]);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px.width, px.height);
  const place = placePage(page.width, page.height, px.width, px.height);
  for (const e of page.elements) drawElement(ctx, e, fonts, place);
  const img = ctx.getImageData(0, 0, px.width, px.height);
  thresholdToBlackWhite(img.data, opts.threshold ?? BLACK_THRESHOLD);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The label picture couldn't be made."))), "image/png");
  });
}

/** One page as a PNG at the printer's resolution (recorded in the file). */
export async function renderLabelPng(page: LabelPage, opts: LabelImageOptions = {}): Promise<Blob> {
  const blob = await canvasPng(await renderLabelCanvas(page, opts));
  const bytes = withPngResolution(new Uint8Array(await blob.arrayBuffer()), opts.dotsPerMm ?? KATASYMBOL_DOTS_PER_MM);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}

/** Every page as a PNG file named after its label ("CLAMP-07.png"), in order. */
export async function labelPngFiles(pages: NamedLabelPage[], opts: LabelImageOptions = {}): Promise<File[]> {
  await fontsFor(pages.map((p) => p.page));
  const taken = new Set<string>();
  const files: File[] = [];
  for (const p of pages) {
    const blob = await renderLabelPng(p.page, opts);
    files.push(new File([blob], labelImageFileName(p.name, taken), { type: "image/png", lastModified: Date.now() }));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Handing the pictures over (browser only)

/**
 * True on an iPhone, iPad or Android phone that can hand a file to the share
 * sheet (where Labelife takes a PDF, and "Save Image" or Katasymbol a picture).
 */
export function detectShareDevice(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  const ua = navigator.userAgent;
  const ipadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod|Android/i.test(ua) || ipadOs;
}

/** Whether the share sheet takes these files (all of them at once). */
export function canShareFiles(files: File[]): boolean {
  if (!files.length || typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/** Saves a file through the browser's downloads. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens the picture in a new tab (on a phone: press and hold it, Save to Photos). False when blocked. */
export function openFile(file: File): boolean {
  const url = URL.createObjectURL(file);
  const w = window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return !!w;
}
