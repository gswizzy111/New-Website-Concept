import { endPartnerSession } from "@/lib/partner-portal";

// A 303 so the browser follows the dashboard's form post with a GET, and a
// relative Location so it stays on the domain it is on
export async function POST() {
  await endPartnerSession();
  return new Response(null, { status: 303, headers: { Location: "/partners" } });
}
