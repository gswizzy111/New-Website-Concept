import { layoutBagLabels } from "./layout";
import { bagLabelsPdf, renderLabelPdf } from "./pdf";
import { layoutPlaceLabel } from "./place";
import { LABEL_STOCKS, PLACE_LABEL_STOCK, fullWidthPoints, isStockId, stockPixels, stockPoints, type LabelStockId } from "./stock";
import type { LabelBagWithId, LabelPlaceWithId } from "./data";
import type { LabelPage } from "./types";

// What the label routes send back (server only): the PDF, or with
// ?format=json the laid-out pages the preview draws (same engine, same data).
// One label per tier bag, always exactly one page each. There is no
// reusable tag any more: ?tag=1 is ignored and the label is returned.
// Slots and places (place.ts): one label each, on 50 x 80 mm unless ?stock=
// asks for another stock (4x6 for a big shelf sign).

const NO_STORE = { "Cache-Control": "private, no-store" };

export type LabelPreviewBag = {
  id: string;
  bagCode: string;
  cardCount: number;
  labelPrintedAt: string | null;
  /**
   * The bag's label: always exactly one page. Its `cardCodes` are the Card
   * IDs it lists; fewer than `cardCount` means the label ends with
   * "+N more: scan the QR".
   */
  labels: LabelPage[];
  /** Retired (the reusable tag was dropped): never sent. Kept optional so older readers still type-check. */
  tag?: LabelPage;
};

export type LabelPreviewResponse = {
  settings: { stock: LabelStockId; contentWidthIn: number; widthIn: number; heightIn: number };
  bags: LabelPreviewBag[];
};

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "labels";
}

export async function labelResponse(
  request: Request,
  bags: LabelBagWithId[],
  settings: { stock: LabelStockId; contentWidthIn: number },
  name: string,
): Promise<Response> {
  const url = new URL(request.url);
  const stock = stockPoints(settings.stock, settings.contentWidthIn);
  const size = LABEL_STOCKS[settings.stock];

  if (url.searchParams.get("format") === "json") {
    const body: LabelPreviewResponse = {
      settings: { ...settings, widthIn: size.widthIn, heightIn: size.heightIn },
      bags: bags.map((b) => ({
        id: b.id,
        bagCode: b.bagCode,
        cardCount: b.cards.length,
        labelPrintedAt: b.labelPrintedAt,
        labels: layoutBagLabels(b, stock),
      })),
    };
    return Response.json(body, { headers: NO_STORE });
  }

  const title = bags.length === 1 ? `Bag label ${name}` : `Bag labels ${name}`;
  const { bytes } = await bagLabelsPdf(bags, stock, title);
  return new Response(Buffer.from(bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName(name)}-${bags.length === 1 ? "label" : "labels"}.pdf"`,
    },
  });
}

// ── Place labels (slots and signs) ───────────────────────────────────────────

/** The stock a place label prints on: ?stock=<id> (4x6 for a big shelf sign), else 50 x 80 mm. */
export function placeStock(url: URL): LabelStockId {
  const asked = url.searchParams.get("stock");
  return isStockId(asked) ? asked : PLACE_LABEL_STOCK;
}

/** The stock as the JSON sends it: its size, and its size in printer dots (for a PNG the Katasymbol app imports). */
export type PlaceLabelSettings = {
  stock: LabelStockId;
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** The page in printer dots at `dpi`: 400 x 640 for 50 x 80 mm at 203 dpi. */
  pixels: { width: number; height: number };
};

/** GET /api/admin/track/locations/labels?format=json: one page per place. */
export type PlaceLabelsResponse = {
  settings: PlaceLabelSettings;
  pages: { id: string; code: string; name: string; page: LabelPage }[];
};

/** GET /api/admin/track/locations/<id>/sign?format=json */
export type PlaceSignResponse = { settings: PlaceLabelSettings; page: LabelPage };

function placeSettings(stock: LabelStockId): PlaceLabelSettings {
  const s = LABEL_STOCKS[stock];
  const px = stockPixels(stock);
  return { stock, widthIn: s.widthIn, heightIn: s.heightIn, dpi: px.dpi, pixels: { width: px.width, height: px.height } };
}

function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"` },
  });
}

/**
 * One label per place (slots "CLAMP 01" to "CLAMP 20", or any places), in
 * order, at the stock's whole width: the PDF, or with ?format=json the pages.
 */
export async function placeLabelsResponse(request: Request, places: LabelPlaceWithId[], name: string): Promise<Response> {
  const url = new URL(request.url);
  const stockId = placeStock(url);
  const stock = fullWidthPoints(stockId);
  const pages = places.map((p) => ({ id: p.id, code: p.code, name: p.name, page: layoutPlaceLabel(p, stock) }));
  if (url.searchParams.get("format") === "json") {
    const body: PlaceLabelsResponse = { settings: placeSettings(stockId), pages };
    return Response.json(body, { headers: NO_STORE });
  }
  const { bytes } = await renderLabelPdf(pages.map((p) => p.page), { title: places.length === 1 ? `Label ${places[0].name}` : `Labels ${name}` });
  return pdfResponse(bytes, `${safeName(name)}-${places.length === 1 ? "label" : "labels"}.pdf`);
}

/** One place's sign: the PDF, or with ?format=json the page. */
export async function placeSignResponse(request: Request, place: LabelPlaceWithId): Promise<Response> {
  const url = new URL(request.url);
  const stockId = placeStock(url);
  const page = layoutPlaceLabel(place, fullWidthPoints(stockId));
  if (url.searchParams.get("format") === "json") {
    const body: PlaceSignResponse = { settings: placeSettings(stockId), page };
    return Response.json(body, { headers: NO_STORE });
  }
  const { bytes } = await renderLabelPdf([page], { title: `Sign ${place.name}` });
  return pdfResponse(bytes, `${safeName(place.code)}-sign.pdf`);
}
