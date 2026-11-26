import { newSetupLink } from "@/lib/workshop-users";
import { UUID, json, respond, teamAdmin } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * POST → { worker, setupUrl, expiresAt, endedSessions } (Reset; full admins only)
 * A new one-time setup link (7 days) in place of any earlier one. It clears
 * the worker's password and signs them out everywhere: the old password stops
 * working at once and they choose a new one with the link.
 * 404 { error } unknown worker.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await teamAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "That worker wasn't found." }, 404);
  return respond(await newSetupLink(id));
}
