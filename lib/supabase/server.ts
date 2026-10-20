import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PREVIEW_MODE, previewFetch } from "@/lib/preview";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(PREVIEW_MODE ? { global: { fetch: previewFetch } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from Server Component — can be ignored if middleware handles refresh
          }
        },
      },
    }
  );
}
