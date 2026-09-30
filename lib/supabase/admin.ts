import { createClient } from "@supabase/supabase-js";
import { PREVIEW_MODE, previewFetch } from "@/lib/preview";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, ...(PREVIEW_MODE ? { global: { fetch: previewFetch } } : {}) }
  );
}
