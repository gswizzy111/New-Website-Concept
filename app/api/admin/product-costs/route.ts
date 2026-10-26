import { z } from "zod";
import { getProductCosts, parseProductCostsConfig, saveProductCosts, updateProductCosts } from "@/lib/product-costs";
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

// The whole config (P&L restoration costs, which sends back what it read)
export async function POST(req: Request) {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const config = parseProductCostsConfig(await req.json().catch(() => null));
  if (!config) return Response.json({ error: "Invalid product costs." }, { status: 400 });
  try {
    await saveProductCosts(config);
  } catch (err) {
    console.error("[product-costs] save failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: SAVE_FAILED }, { status: 500 });
  }
  return Response.json({ ok: true });
}

const Components = z.array(z.object({
  name: z.string().trim().min(1).max(200),
  cost_cents: z.number().int().min(0).max(100_000_000),
})).max(100);

// One change, applied to the saved config on the server (product page):
// a product's components, or one preset added or removed
const Change = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_product"), product_id: z.string().min(1).max(100), components: Components }),
  z.object({ action: z.literal("add_preset"), name: z.string().trim().min(1).max(200), components: Components.min(1) }),
  z.object({ action: z.literal("delete_preset"), id: z.string().min(1).max(100) }),
]);

export async function PATCH(req: Request) {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid product costs." }, { status: 400 });
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
      } else {
        c.presets = c.presets.filter((p) => p.id !== change.id);
      }
    });
    return Response.json({ ok: true, presets: config.presets });
  } catch (err) {
    console.error("[product-costs] update failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: SAVE_FAILED }, { status: 500 });
  }
}
