import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const Body = z.object({ token_hash: z.string().min(10) });

// The confirm link's button: verifying the one-time token confirms the email
// and signs the customer in (session cookies set by the server client).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "This link is incomplete." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: parsed.data.token_hash });
  if (error) {
    return Response.json({ error: "This link has expired or was already used. Sign in to get a new one." }, { status: 400 });
  }
  return Response.json({ ok: true });
}
