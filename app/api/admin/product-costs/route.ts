import { z } from "zod";
import { getProductCosts, updateProductCosts } from "@/lib/product-costs";
import { isAdmin } from "@/lib/admin-auth";

async function authed() {
  return isAdmin();
}

const READ_FAILED = "Product costs couldn't be loaded. Nothing was changed. Please try again.";
const SAVE_FAILED = "Product costs couldn't be saved. Please try again.";

export async function GET() {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await getProductCosts());
  } catch (err) {
    console.error("[product-costs] read failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: READ_FAILED }, { status: 500 });
  }
}

const Cents = z.number().int().min(0).max(100_000_000);
const Restoration = z.object({ regular_cents: Cents, expedited_cents: Cents, premium_cents: Cents, ultra_premium_cents: Cents });

/** 400, saying so when a cost is out of range (the form can't stop a typed negative). */
function invalid(error: z.ZodError) {
  const cost = error.issues.some((i) => /_cents$/.test(String(i.path[i.path.length - 1] ?? "")));
  return Response.json({ error: cost ? "Each cost must be from $0 to $1,000,000." : "Invalid product costs." }, { status: 400 });
}

// P&L Restoration Supply Costs. It sends back the whole config it read, but
// only its restoration costs are used: products and presets saved since that
// read (product page, another tab) are never put back to what it had
export async function POST(req: Request) {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ restoration: Restoration }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const { restoration } = parsed.data;
  try {
    await updateProductCosts((c) => {
      c.restoration = restoration;
    });
  } catch (err) {
    console.error("[product-costs] save failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: SAVE_FAILED }, { status: 500 });
  }
  return Response.json({ ok: true });
}

const Components = z.array(z.object({
  name: z.string().trim().min(1).max(200),
  cost_cents: Cents,
})).max(100);

// Products are keyed by their id (a uuid)
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One change, applied to the saved config on the server: a product's
// components, one preset added or removed (product page), or the
// restoration supply costs (P&L)
const Change = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_product"), product_id: z.string().regex(PRODUCT_ID), components: Components }),
  z.object({ action: z.literal("add_preset"), name: z.string().trim().min(1).max(200), components: Components.min(1) }),
  z.object({ action: z.literal("delete_preset"), id: z.string().min(1).max(100) }),
  z.object({ action: z.literal("set_restoration"), restoration: Restoration }),
]);

export async function PATCH(req: Request) {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const change = parsed.data;
  try {
    const config = await updateProductCosts((c) => {
      if (change.action === "set_product") {
        c.products[change.product_id] = {
          components: change.components,
          cost_cents: change.components.reduce((s, x) => s + x.cost_cents, 0),
        };
      } else if (change.action === "add_preset") {
        c.presets = [...c.presets, { id: crypto.randomUUID(), name: change.name, components: change.components }];
      } else if (change.action === "delete_preset") {
        c.presets = c.presets.filter((p) => p.id !== change.id);
      } else {
        c.restoration = change.restoration;
      }
    });
    return Response.json({ ok: true, presets: config.presets });
  } catch (err) {
    console.error("[product-costs] update failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: SAVE_FAILED }, { status: 500 });
  }
}
