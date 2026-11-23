import { layoutBagLabels } from "./layout";
import { bagLabelsPdf } from "./pdf";
import { LABEL_STOCKS, stockPoints, type LabelStockId } from "./stock";
import type { LabelBagWithId } from "./data";
import type { LabelPage } from "./types";

// What the label routes send back (server only): the PDF, or with
// ?format=json the laid-out pages the preview draws (same engine, same data).
// One label per tier bag, always exactly one page each. There is no
// reusable tag any more: ?tag=1 is ignored and the label is returned.

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
