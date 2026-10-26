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
  return error.status === 404 || error.statusCode === "404" || /not.?found|NoSuchKey/i.test(`${error.statusCode ?? ""} ${error.message ?? ""}`);
}

/**
 * The saved config, or the empty default when it has never been saved.
 * Throws when it can't be read, so nothing is ever saved over a config that
 * wasn't read (every product's costs and presets live in this one file).
 */
export async function readProductCosts(): Promise<ProductCostsConfig> {
  const admin = createAdminClient();
  await ensureBucket(admin);
  const { data, error } = await admin.storage.from(BUCKET).download(FILE);
  if (error) {
    if (isMissingFile(error as { message?: string; status?: number; statusCode?: string })) return structuredClone(DEFAULT);
    throw new Error(`Product costs could not be read: ${error.message}`);
  }
  if (!data) throw new Error("Product costs could not be read: empty answer");
  const parsed = JSON.parse(await data.text());
  return {
    products: parsed.products ?? {},
    restoration: { ...DEFAULT.restoration, ...(parsed.restoration ?? {}) },
    presets: parsed.presets ?? [],
  };
}

/** For display: the saved config, or the empty default if it can't be read. */
export async function getProductCosts(): Promise<ProductCostsConfig> {
  try {
    return await readProductCosts();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return structuredClone(DEFAULT);
  }
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
  const config = await readProductCosts();
  change(config);
  await saveProductCosts(config);
  return config;
}
