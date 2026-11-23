import { layoutBagLabels, layoutBagTag } from "./layout";
import { bagLabelsPdf, bagTagsPdf } from "./pdf";
import { LABEL_STOCKS, stockPoints, type LabelStockId } from "./stock";
import type { LabelBagWithId } from "./data";
import type { LabelPage } from "./types";

// What the label routes send back (server only): the PDF, or with
// ?format=json the laid-out pages the preview draws (same engine, same data).

const NO_STORE = { "Cache-Control": "private, no-store" };

export type LabelPreviewBag = {
  id: string;
  bagCode: string;
  cardCount: number;
  labelPrintedAt: string | null;
  labels: LabelPage[];
  tag: LabelPage;
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
        tag: layoutBagTag(b, stock),
      })),
    };
    return Response.json(body, { headers: NO_STORE });
  }

  const tag = url.searchParams.get("tag") === "1";
  const title = tag ? `Bag tag ${name}` : `Bag labels ${name}`;
  const { bytes } = tag ? await bagTagsPdf(bags, stock, title) : await bagLabelsPdf(bags, stock, title);
  return new Response(Buffer.from(bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName(name)}-${tag ? "tag" : "labels"}.pdf"`,
    },
  });
}
