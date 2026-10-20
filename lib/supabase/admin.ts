import { createClient } from "@supabase/supabase-js";
import { PREVIEW_MODE, previewFetch } from "@/lib/preview";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // Preview deploys may not have the service key yet: fall back to the anon
    // key so pages render their defaults instead of crashing.
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? (PREVIEW_MODE ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined))!,
    { auth: { persistSession: false }, ...(PREVIEW_MODE ? { global: { fetch: previewFetch } } : {}) }
  );
}
