import { z } from "zod";
import { addressProblem, normalizeAddress } from "@/lib/shipping-address";
import { usAddressRejection } from "@/lib/verify-address";
import { quoteKitRates } from "@/lib/kit-shipping";

const Body = z.object({
  name: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  address: z.object({
    street1: z.string(),
    street2: z.string().optional(),
    city: z.string(),
    state: z.string().optional().default(""),
    zip: z.string(),
    country: z.string().default("US"),
  }),
  item_names: z.array(z.string()).max(50).default([]),
  declared_value_cents: z.number().int().min(0).max(10_000_00).default(0),
});

// Kit shipping options for the cart: live rates for this address and parcel,
// each priced with handling. The address is checked first (and with USPS in
// the US), so a bad address is caught before the customer picks a speed.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter your full shipping address." }, { status: 400 });

  const address = normalizeAddress(parsed.data.address);
  const problem = addressProblem(address);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (address.country === "US") {
    const rejection = await usAddressRejection(address, parsed.data.name);
    if (rejection) {
      const advice = /please check/i.test(rejection) ? "" : " Please check it and try again.";
      return Response.json({ error: `We couldn't verify that address with USPS: ${rejection}${advice}` }, { status: 400 });
    }
  }

  try {
    const rates = await quoteKitRates({
      address,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      itemNames: parsed.data.item_names,
      declaredValueCents: parsed.data.declared_value_cents,
    });
    if (rates.length === 0) {
      return Response.json({ error: "No shipping options are available for this address. Please check it, or DM us on Instagram." }, { status: 422 });
    }
    return Response.json({ rates });
  } catch (err) {
    console.error("Kit shipping rates failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "We couldn't get shipping prices right now. Please try again." }, { status: 502 });
  }
}
