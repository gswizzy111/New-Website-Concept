// Preview mode: the site renders with no real backend (no Supabase, Stripe,
// Shippo, Resend). Turned on with NEXT_PUBLIC_PREVIEW_MODE=true, e.g. on a
// Netlify preview deploy. Never set this on the live site.
export const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "true";

export const PREVIEW_MESSAGE =
  "Not functional yet. This is a preview of the new site, so checkout, payments, shipping and accounts are turned off.";

// In preview mode there is no database to reach, so Supabase clients get a
// fetch that answers instantly with an error (a network failure or a 503 makes
// supabase-js retry for ~7s). Pages already fall back when a query errors.
export const previewFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ message: "Preview mode: backend not connected", code: "PREVIEW" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
