// Preloaded into `next dev` by start.mjs (NODE_OPTIONS --import): every
// request the app makes to https://api.goshippo.com goes to the harness's
// fake Shippo instead (HARNESS_SHIPPO_URL, <mock>/__shippo, mock-shippo.mjs).
// The Shippo SDK and the app's plain fetch calls both use the global fetch,
// so wrapping it here covers them without touching the app. Anything else
// passes through unchanged. Harness only: nothing in the app reads
// HARNESS_SHIPPO_URL.
const target = (process.env.HARNESS_SHIPPO_URL ?? "").replace(/\/+$/, "");
const SHIPPO = /^https:\/\/api\.goshippo\.com(?=\/|$)/i;

if (target && typeof globalThis.fetch === "function" && !globalThis.__harnessShippoFetch) {
  const real = globalThis.fetch;
  const wrapped = async function harnessShippoFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!url || !SHIPPO.test(url)) return real(input, init);
    const to = url.replace(SHIPPO, target);
    if (typeof Request !== "undefined" && input instanceof Request) {
      const method = init?.method ?? input.method;
      const headers = new Headers(init?.headers ?? input.headers);
      const body = init?.body ?? (method === "GET" || method === "HEAD" ? undefined : await input.arrayBuffer());
      return real(to, { method, headers, body, signal: init?.signal ?? input.signal });
    }
    return real(to, init);
  };
  globalThis.__harnessShippoFetch = true;
  globalThis.fetch = wrapped;
}
