import { unsubscribeByToken } from "@/lib/email-unsubscribe";

/**
 * Unsubscribes an address from marketing email (lib/email-unsubscribe.ts).
 * No sign-in: the random token from the email is the proof.
 *
 * POST ?token=…  One-click from the mail app (the List-Unsubscribe-Post header
 *                makes it send the form body "List-Unsubscribe=One-Click"),
 *                or the button on /email/unsubscribe (JSON { token }).
 * GET  ?token=…  A mail app that opens the header's link in a browser: it goes
 *                to the page, which asks for a press, so link scanners that
 *                open every link can't unsubscribe anyone.
 */

async function tokenFrom(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("token");
  if (fromQuery) return fromQuery.trim();
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return typeof body?.token === "string" ? body.token.trim() : "";
    }
    if (type.includes("form")) {
      const value = (await request.formData()).get("token");
      return typeof value === "string" ? value.trim() : "";
    }
  } catch {
    // An unreadable body has no token
  }
  return "";
}

export async function POST(request: Request) {
  const token = await tokenFrom(request);
  try {
    const email = await unsubscribeByToken(token);
    if (!email) return Response.json({ error: "This unsubscribe link isn't valid." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Unsubscribe failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "We couldn't unsubscribe you just now. Please try again in a minute." }, { status: 500 });
  }
}

export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const page = new URL("/email/unsubscribe", request.url);
  if (token) page.searchParams.set("token", token);
  return Response.redirect(page, 303);
}
