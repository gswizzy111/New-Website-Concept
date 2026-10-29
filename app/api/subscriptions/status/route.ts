import { z } from "zod";
import { emailForKitClubToken, monthlyPriceCents, publicView, signedInEmail, subscriptionForEmail } from "@/lib/kit-club-link";

const Body = z.object({ token: z.string().max(200).optional() });

// The manage page's view of a subscription, only for someone who proved the
// inbox: the emailed link's token (posted, so it stays out of request logs),
// or a signed-in account with a confirmed email. Nothing for anyone else.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { token } = parsed.data;

  let email: string | null;
  if (token) {
    email = await emailForKitClubToken(token);
    if (!email) return Response.json({ code: "LINK_EXPIRED" }, { status: 403 });
  } else {
    email = await signedInEmail();
    if (!email) return Response.json({ found: false });
  }

  const sub = await subscriptionForEmail(email);
  if (sub === undefined) return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  if (!sub) return Response.json({ found: false });
  return Response.json(publicView(sub, await monthlyPriceCents(sub)));
}
