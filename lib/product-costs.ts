import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "app-config";
const FILE = "product-costs.json";

export interface ProductComponent {
  name: string;
  cost_cents: number;
}

export interface ProductCostEntry {
  components: ProductComponent[];
  cost_cents: number;
}

export interface RestorationCosts {
  regular_cents: number;
  expedited_cents: number;
  premium_cents: number;
  ultra_premium_cents: number;
}

export interface ComponentPreset {
  id: string;
  name: string;
  components: ProductComponent[];
}

export interface ProductCostsConfig {
  products: Record<string, ProductCostEntry>;
  restoration: RestorationCosts;
  presets: ComponentPreset[];
}

const DEFAULT: ProductCostsConfig = {
  products: {},
  restoration: { regular_cents: 0, expedited_cents: 0, premium_cents: 0, ultra_premium_cents: 0 },
  presets: [],
};

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
}

/** Supabase Storage's answer when the file has never been saved. */
function isMissingFile(error: { message?: string; status?: number; statusCode?: string }): boolean {
  return error.status === 404 || error.statusCode === "404" || /object not found|NoSuchKey/i.test(`${error.statusCode ?? ""} ${error.message ?? ""}`);
}

const RESTORATION_KEYS = ["regular_cents", "expedited_cents", "premium_cents", "ultra_premium_cents"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A whole config sent to be saved, or null unless it has the config's shape:
 * products an object of product entries, presets a list, and restoration
 * all four costs. Every product's costs and presets live in this one file,
 * so a partial or empty config is never saved over it.
 */
export function parseProductCostsConfig(value: unknown): ProductCostsConfig | null {
  if (!isRecord(value) || !isRecord(value.products) || !Array.isArray(value.presets) || !isRecord(value.restoration)) return null;
  if (!Object.values(value.products).every(isRecord)) return null;
  if (!value.presets.every((p) => isRecord(p) && typeof p.id === "string")) return null;
  const r = value.restoration;
  if (!RESTORATION_KEYS.every((k) => isCents(r[k]))) return null;
  return {
    products: value.products as ProductCostsConfig["products"],
    restoration: Object.fromEntries(RESTORATION_KEYS.map((k) => [k, r[k]])) as unknown as RestorationCosts,
    presets: value.presets as ComponentPreset[],
  };
}

/**
 * The saved config, or the empty default only when it has never been saved.
 * Throws when it can't be read or parsed, so nothing is ever saved over a
 * config that wasn't read (GET /api/admin/product-costs answers 500).
 */
export async function getProductCosts(): Promise<ProductCostsConfig> {
  const admin = createAdminClient();
  await ensureBucket(admin);
  const { data, error } = await admin.storage.from(BUCKET).download(FILE);
  if (error) {
    if (isMissingFile(error as { message?: string; status?: number; statusCode?: string })) return structuredClone(DEFAULT);
    throw new Error(`Product costs could not be read: ${error.message}`);
  }
  if (!data) throw new Error("Product costs could not be read: empty answer");
  const parsed: unknown = JSON.parse(await data.text());
  if (!isRecord(parsed)) throw new Error("Product costs could not be read: the saved file is not a config");
  return {
    products: isRecord(parsed.products) ? (parsed.products as ProductCostsConfig["products"]) : {},
    restoration: { ...DEFAULT.restoration, ...(isRecord(parsed.restoration) ? parsed.restoration : {}) },
    presets: Array.isArray(parsed.presets) ? (parsed.presets as ComponentPreset[]) : [],
  };
}

/** Saves the whole config. Throws if the save fails. */
export async function saveProductCosts(config: ProductCostsConfig): Promise<void> {
  const admin = createAdminClient();
  await ensureBucket(admin);
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const { error } = await admin.storage.from(BUCKET).upload(FILE, blob, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Product costs could not be saved: ${error.message}`);
}

/**
 * Reads the saved config, applies one change and saves it, all on the
 * server: a change to one product or preset never replaces the rest with
 * what a browser happened to have. Throws if the read or the save fails.
 */
export async function updateProductCosts(change: (config: ProductCostsConfig) => void): Promise<ProductCostsConfig> {
  const config = await getProductCosts();
  change(config);
  await saveProductCosts(config);
  return config;
}
