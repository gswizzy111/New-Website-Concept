/**
 * Label pictures for the Katasymbol (components/intake/label-image.ts): the
 * pure parts. Pixel sizes (50 x 80 mm = 400 x 640 dots at 203 dpi), fitting
 * another page size onto the label, whole-pixel QR modules, the black/white
 * cut, reading every label route's JSON shape, file names, the JSON address,
 * and the PNG resolution chunk. Drawing needs a browser canvas: not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  KATASYMBOL_DOTS_PER_MM,
  KATASYMBOL_LABEL_MM,
  HIGH_RES_DOTS_PER_MM,
  crc32,
  isPageSize,
  labelImageFileName,
  labelJsonUrl,
  labelPagesFromJson,
  labelPixelSize,
  mmToDots,
  pageSizeMm,
  placePage,
  qrPixelGrid,
  thresholdToBlackWhite,
  withPngResolution,
} from "@/components/intake/label-image";
import type { LabelPage } from "@/lib/intake/labels/types";

const PT = 72 / 25.4; // points per mm
const page50x80: LabelPage = { width: 50 * PT, height: 80 * PT, elements: [], cardCodes: [] };
const page4x6: LabelPage = { width: 4 * 72, height: 6 * 72, elements: [], cardCodes: [] };

test("a 50 x 80 mm label is 400 x 640 dots at 203 dpi (8 dots/mm), 590 x 944 at 300 dpi", () => {
  assert.equal(KATASYMBOL_DOTS_PER_MM, 8);
  assert.deepEqual(labelPixelSize(KATASYMBOL_LABEL_MM), { width: 400, height: 640 });
  assert.deepEqual(labelPixelSize(KATASYMBOL_LABEL_MM, HIGH_RES_DOTS_PER_MM), { width: 590, height: 944 });
  // From the page's own size in points (the layout's unit), the same dots
  assert.deepEqual(labelPixelSize(pageSizeMm(page50x80)), { width: 400, height: 640 });
  assert.equal(mmToDots(0), 1, "never zero pixels");
});

test("page sizes: 50 x 80 mm is recognised, 4 x 6 in is not", () => {
  const mm = pageSizeMm(page50x80);
  assert.ok(Math.abs(mm.width - 50) < 1e-9 && Math.abs(mm.height - 80) < 1e-9);
  assert.equal(isPageSize(page50x80, KATASYMBOL_LABEL_MM), true);
  assert.equal(isPageSize(page4x6, KATASYMBOL_LABEL_MM), false);
});

test("a 50 x 80 mm page fills the picture; a 4 x 6 page shrinks onto it, centered", () => {
  const exact = placePage(page50x80.width, page50x80.height, 400, 640);
  assert.ok(Math.abs(exact.scale - 400 / page50x80.width) < 1e-9);
  assert.ok(Math.abs(exact.offsetX) < 1e-9 && Math.abs(exact.offsetY) < 1e-9);
  assert.ok(Math.abs(page50x80.height * exact.scale - 640) < 1e-9);

  const big = placePage(page4x6.width, page4x6.height, 400, 640);
  assert.ok(Math.abs(big.scale - 400 / 288) < 1e-9, "limited by the width");
  assert.equal(big.offsetX, 0);
  assert.ok(Math.abs(big.offsetY - 20) < 1e-9, "white above and below");

  assert.deepEqual(placePage(0, 10, 400, 640), { scale: 1, offsetX: 0, offsetY: 0 });
});

test("QR modules are whole pixels, centered in their box", () => {
  // 1 in QR at 8 dots/mm: 203.2 px box, a 33-module code: 6 px modules, 198 px drawn
  const g = qrPixelGrid(100, 50, 25.4 * 8, 33);
  assert.equal(g.module, 6);
  assert.equal(g.x, Math.round(100 + (203.2 - 198) / 2));
  assert.equal(g.y, Math.round(50 + (203.2 - 198) / 2));
  assert.ok(Number.isInteger(g.x) && Number.isInteger(g.y));
  // Never under a pixel per module
  assert.equal(qrPixelGrid(0, 0, 10, 33).module, 1);
});

test("pixels are cut to pure black or white (transparent is paper)", () => {
  const px = new Uint8ClampedArray([
    0, 0, 0, 255, // black
    200, 200, 200, 255, // light grey: white
    100, 100, 100, 255, // dark grey: black
    0, 0, 0, 0, // transparent: white
    127, 127, 127, 255, // just under half: black
    128, 128, 128, 255, // half: white
  ]);
  const dark = thresholdToBlackWhite(px);
  assert.equal(dark, 3);
  assert.deepEqual([...px], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  // A stricter cut keeps the dark grey white
  const again = new Uint8ClampedArray([100, 100, 100, 255]);
  assert.equal(thresholdToBlackWhite(again, 90), 0);
});

test("every label route's JSON gives its pages in order, each named", () => {
  const a = { ...page50x80, cardCodes: ["A"] };
  const b = { ...page50x80, cardCodes: ["B"] };
  // Bag labels (labels/order, labels/bag)
  assert.deepEqual(
    labelPagesFromJson({ settings: {}, bags: [{ id: "1", bagCode: "CD-2549-P", labels: [a] }, { id: "2", bagCode: "CD-2549-G", labels: [b] }] }).map((p) => [p.name, p.page.cardCodes[0]]),
    [["CD-2549-P", "A"], ["CD-2549-G", "B"]],
  );
  // A bag whose label ran to two pages
  assert.deepEqual(labelPagesFromJson({ bags: [{ bagCode: "CD-1-P", labels: [a, b] }] }).map((p) => p.name), ["CD-1-P-1", "CD-1-P-2"]);
  // Slot labels / signs as a list of { code, page }
  assert.deepEqual(
    labelPagesFromJson({ pages: [{ code: "LOC-CLAMP-01", name: "CLAMP 01", page: a }, { code: "LOC-CLAMP-02", page: b }] }).map((p) => p.name),
    ["LOC-CLAMP-01", "LOC-CLAMP-02"],
  );
  assert.deepEqual(labelPagesFromJson({ labels: [{ location: { code: "LOC-DONE" }, label: a }] }).map((p) => p.name), ["LOC-DONE"]);
  assert.deepEqual(labelPagesFromJson({ slots: [{ name: "CLAMP 07", sign: a }] }).map((p) => p.name), ["CLAMP 07"]);
  // One sign, a bare page, a bare list
  assert.deepEqual(labelPagesFromJson({ code: "LOC-SHIP", page: a }).map((p) => p.name), ["LOC-SHIP"]);
  assert.deepEqual(labelPagesFromJson(a, "sign").map((p) => p.name), ["sign"]);
  assert.deepEqual(labelPagesFromJson([a, b], "slots").map((p) => p.name), ["slots-1", "slots-2"]);
  // Nothing printable
  assert.deepEqual(labelPagesFromJson({ error: "Not found" }), []);
  assert.deepEqual(labelPagesFromJson(null), []);
  assert.deepEqual(labelPagesFromJson({ pages: [{ code: "X", page: { width: 0, height: 1, elements: [] } }] }), []);
});

test("file names are safe and never repeat", () => {
  const taken = new Set<string>();
  assert.equal(labelImageFileName("CLAMP 07", taken), "CLAMP-07.png");
  assert.equal(labelImageFileName("clamp 07", taken), "clamp-07-2.png");
  assert.equal(labelImageFileName("LOC-SHELF-20261207", taken), "LOC-SHELF-20261207.png");
  assert.equal(labelImageFileName("  ", taken), "label.png");
  assert.equal(labelImageFileName("Due: Mon/Dec 7", taken), "Due-Mon-Dec-7.png");
});

test("the pictures' JSON address keeps the PDF route's query", () => {
  const url = labelJsonUrl("/api/admin/intake/labels/order/abc?bags=b1,b2&v=xyz", { stock: "50x80mm" });
  const u = new URL(url, "https://example.test");
  assert.equal(u.pathname, "/api/admin/intake/labels/order/abc");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(u.searchParams.get("stock"), "50x80mm");
  assert.equal(u.searchParams.get("bags"), "b1,b2");
  assert.equal(u.searchParams.get("v"), "xyz");
  assert.ok(url.startsWith("/api/"), "stays same-origin and relative");
  // A stock the caller set is kept
  assert.equal(new URL(labelJsonUrl("/x?stock=4x6", { stock: "50x80mm" }), "https://e.test").searchParams.get("stock"), "4x6");
  assert.equal(new URL(labelJsonUrl("/x?format=pdf"), "https://e.test").searchParams.get("format"), "json");
});

// A real 1 x 1 PNG (signature, IHDR, IDAT, IEND)
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function tinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const idat = new Uint8Array(deflateSync(Buffer.from([0, 255])));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function chunkTypes(png: Uint8Array): string[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let at = 8; at + 12 <= png.length; at += 12 + v.getUint32(at)) {
    types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)));
  }
  return types;
}

test("CRC-32 matches PNG's (IEND's well-known CRC)", () => {
  assert.equal(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44])), 0xae426082);
});

test("the PNG records 8 dots/mm (8000 per metre) right after IHDR, once", () => {
  const png = withPngResolution(tinyPng(), 8);
  assert.deepEqual(chunkTypes(png), ["IHDR", "pHYs", "IDAT", "IEND"]);
  const at = 8 + 25; // after the signature and IHDR
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(v.getUint32(at), 9);
  assert.equal(v.getUint32(at + 8), 8000);
  assert.equal(v.getUint32(at + 12), 8000);
  assert.equal(png[at + 16], 1, "unit: metre");
  assert.equal(v.getUint32(at + 17), crc32(png.subarray(at + 4, at + 17)));
  // Again at 300 dpi: replaced, not doubled
  const again = withPngResolution(png, HIGH_RES_DOTS_PER_MM);
  assert.deepEqual(chunkTypes(again), ["IHDR", "pHYs", "IDAT", "IEND"]);
  assert.equal(new DataView(again.buffer, again.byteOffset).getUint32(at + 8), 11800);
  // Not a PNG: untouched
  const junk = new Uint8Array([1, 2, 3]);
  assert.equal(withPngResolution(junk, 8), junk);
});
