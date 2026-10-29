import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { PARTNER_PASSCODE_MIN, passcodeColumns, passcodeInUse } from "@/lib/partner-portal";

// Never the passcode or its hash
const PUBLIC_COLUMNS = "id, name, store_name, kits_allocated, polish_allocated, spray_allocated, created_at";

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  store_name: z.string().trim().max(200).nullable().optional(),
  passcode: z.string().trim().min(1).max(200),
  kits_allocated: z.number().int().min(0).max(100_000).optional(),
});

async function authed() {
  return isAdmin();
}

export async function GET() {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin.from("partners").select(PUBLIC_COLUMNS).order("created_at", { ascending: false });
  return Response.json(data ?? []);
}

export async function POST(request: Request) {
  if (!await authed()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Name and passcode are required" }, { status: 400 });
  }
  const { name, store_name, passcode, kits_allocated } = parsed.data;
  if (passcode.length < PARTNER_PASSCODE_MIN) {
    return Response.json({ error: `The passcode needs at least ${PARTNER_PASSCODE_MIN} characters.` }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    if (await passcodeInUse(admin, passcode)) {
      return Response.json({ error: "That passcode is already in use. Choose another." }, { status: 409 });
    }
  } catch (err) {
    console.error("Checking partner passcodes failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not create the partner. Please try again." }, { status: 500 });
  }

  const { data, error } = await admin.from("partners").insert({
    name,
    store_name: store_name || null,
    ...(await passcodeColumns(passcode)),
    kits_allocated: kits_allocated ?? 0,
  }).select(PUBLIC_COLUMNS).single();

  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That passcode is already in use. Choose another." }, { status: 409 });
    }
    console.error("Creating a partner failed:", error.message);
    return Response.json({ error: "Could not create the partner. Please try again." }, { status: 500 });
  }
  return Response.json(data);
}
