import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import type { AccountProfile } from "@/lib/account-profile";


type Addr = Partial<{ street1: string; street2: string | null; city: string; state: string; zip: string; phone: string }>;

function cleanAddress(a: Addr | null | undefined): AccountProfile["address"] {
  if (!a?.street1 || !a.city || !a.zip) return null;
  return { street1: a.street1, street2: a.street2 ?? "", city: a.city, state: a.state ?? "", zip: a.zip };
}

/**
 * The signed-in customer's details for prefilling checkout: what they saved in
 * Settings, else what they used on their latest order. Not signed in → 204.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at) return new Response(null, { status: 204 });

  const meta = (user.user_metadata ?? {}) as { name?: string; phone?: string; address?: Addr };
  let phone = meta.phone ?? "";
  let address = cleanAddress(meta.address);

  if (!phone || !address) {
    const admin = createAdminClient();
    const [{ data: lastOrder }, { data: lastKit }] = await Promise.all([
      admin.from("orders").select("customer_phone, ship_from_address, created_at")
        .ilike("customer_email", user.email).neq("status", "awaiting_payment")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("shop_orders").select("customer_phone, shipping_address, created_at")
        .ilike("customer_email", user.email)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const newest = [lastOrder && { phone: lastOrder.customer_phone, addr: lastOrder.ship_from_address as Addr, at: lastOrder.created_at },
      lastKit && { phone: lastKit.customer_phone, addr: lastKit.shipping_address as Addr, at: lastKit.created_at }]
      .filter(Boolean)
      .sort((a, b) => Date.parse(b!.at) - Date.parse(a!.at)) as { phone: string | null; addr: Addr; at: string }[];
    for (const o of newest) {
      if (!phone && o.phone) phone = o.phone;
      if (!address && cleanAddress(o.addr)?.state) address = cleanAddress(o.addr);
    }
  }

  const profile: AccountProfile = { name: meta.name ?? "", email: user.email, phone, address };
  return Response.json(profile);
}

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  phone: z.string().trim().max(30).optional().default(""),
  address: z.object({
    street1: z.string().trim().max(200),
    street2: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().max(100),
    state: z.string().trim().max(40),
    zip: z.string().trim().max(20),
  }).nullable().optional(),
});

/** Saves name, phone and default shipping address on the account. */
export async function PATCH(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });

  const { name, phone, address } = parsed.data;
  const { error } = await supabase.auth.updateUser({
    data: { name, phone, address: address && address.street1 ? address : null },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
