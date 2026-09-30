// Preview mode: the site renders with no real backend (no Supabase, Stripe,
// Shippo, Resend). Turned on with NEXT_PUBLIC_PREVIEW_MODE=true, e.g. on a
// Netlify preview deploy. Never set this on the live site.
export const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "true";

export const PREVIEW_MESSAGE =
  "Not functional yet. This is a preview of the new site, so checkout, payments, shipping and accounts are turned off.";

const NO_BACKEND = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(".invalid");

const fakeError = () =>
  new Response(JSON.stringify({ message: "Preview mode: read-only", code: "PREVIEW" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

// Supabase fetch used in preview mode.
// - With a real Supabase URL configured, reads (GET/HEAD) go through so pages
//   show real products, prices and settings, and every write (POST, PATCH,
//   PUT, DELETE: inserts, updates, uploads, RPCs) is refused before it leaves
//   the server. The database cannot be changed from a preview deploy.
// - With the placeholder URL (no backend), every call fails instantly.
// Refusals answer with a 500 because supabase-js retries network errors and
// 503s for ~7s. Pages already fall back when a query errors.
export const previewFetch: typeof fetch = async (input, init) => {
  if (NO_BACKEND) return fakeError();
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") return fakeError();
  return fetch(input, init);
};
