import { isAdmin } from "@/lib/admin-auth";

/**
 * Fetches a shipping label for the admin's label printer check (lib/qz-print.ts).
 * Only Shippo's label hosts, over https: every label URL in the database is on
 * deliver.goshippo.com, and Shippo has also served labels from its
 * shippo-delivery S3 buckets. Redirects are followed only to those same hosts.
 */
const LABEL_HOSTS = new Set(["deliver.goshippo.com"]);
const SHIPPO_S3_HOST = /^shippo-delivery(?:-[a-z0-9-]+)?\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
// The same buckets addressed by path (s3.amazonaws.com/shippo-delivery-.../...)
const S3_PATH_HOST = /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
const SHIPPO_S3_PATH = /^\/shippo-delivery(?:-[a-z0-9-]+)?\//;
const MAX_REDIRECTS = 3;
const MAX_LABEL_BYTES = 10 * 1024 * 1024;

function allowedLabelUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  const ok = LABEL_HOSTS.has(host) || SHIPPO_S3_HOST.test(host) || (S3_PATH_HOST.test(host) && SHIPPO_S3_PATH.test(url.pathname));
  return ok ? url : null;
}

export async function HEAD(req: Request) {
  return GET(req);
}

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("url");
  if (!raw) return new Response("Missing url param", { status: 400 });

  let url = allowedLabelUrl(raw);
  if (!url) return new Response("Not a Shippo label URL", { status: 400 });

  try {
    let upstream: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const next = allowedLabelUrl(upstream.headers.get("Location") ?? "", url.toString());
      if (!next || hop === MAX_REDIRECTS) return new Response("Failed to fetch label", { status: 502 });
      url = next;
    }
    if (!upstream || !upstream.ok) return new Response("Failed to fetch label", { status: 502 });

    const length = Number(upstream.headers.get("Content-Length") ?? 0);
    if (length > MAX_LABEL_BYTES) return new Response("Failed to fetch label", { status: 502 });
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_LABEL_BYTES) return new Response("Failed to fetch label", { status: 502 });
    const contentType = upstream.headers.get("Content-Type") ?? "application/octet-stream";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        // Tell client what format this is so it can choose PDF vs ZPL printing
        "X-Label-Format": contentType.includes("pdf") ? "pdf" : "zpl",
        // Shown to the admin only as a download, never run as a page
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (err) {
    console.error("Label fetch failed:", err instanceof Error ? err.message : err);
    return new Response("Failed to fetch label", { status: 502 });
  }
}
