import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS_VERSION } from "@/lib/legal/current-terms";
import { ensureTermsVersion } from "@/lib/terms-versions";
import { masterDocumentHash, requestOrigin } from "@/lib/signatures";
import { takeAttempt } from "@/lib/attempt-limit";
import { ShowDropoffSchema, dropoffSignedText } from "@/lib/show-dropoffs";
import { getDropoffServices } from "@/lib/show-dropoff-services";

/**
 * Saves a show drop-off (the public /show-dropoffs form): the customer, their
 * return address, services, cards and their signature on the Terms. No
 * payment. Returns the drop-off number to show at the table.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ShowDropoffSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Some details are missing or don't look right. Check the highlighted fields and try again." }, { status: 400 });
  }
  const d = parsed.data;
  if (d.signing.version !== TERMS_VERSION) {
    return Response.json({ error: "The Terms of Service were updated. Please reload the page and sign again." }, { status: 409 });
  }

  // A form anyone can post: a few per email address, and a ceiling for everyone
  const perEmail = await takeAttempt("show-dropoff", d.customer.email, { max: 10, windowMinutes: 60 });
  if (perEmail.wait > 0) {
    return Response.json({ error: "Too many drop-offs from this email in the last hour. Please ask us at the table." }, { status: 429 });
  }
  const everyone = await takeAttempt("show-dropoff", "all", { max: 300, windowMinutes: 60 });
  if (everyone.wait > 0) {
    await perEmail.release();
    return Response.json({ error: "We're getting a lot of drop-offs right now. Please wait a minute and try again." }, { status: 429 });
  }

  const admin = createAdminClient();
  try {
    const [terms, services] = await Promise.all([ensureTermsVersion(admin), getDropoffServices()]);
    const signedText = dropoffSignedText(d, services);
    const { ip, userAgent } = requestOrigin(request);
    const c = d.customer;

    const { data, error } = await admin
      .from("show_dropoffs")
      .insert({
        show_name: d.show || null,
        customer_name: c.name,
        customer_email: c.email.toLowerCase(),
        customer_phone: c.phone,
        return_address: {
          name: c.name,
          street1: c.street1,
          street2: c.street2 || null,
          city: c.city,
          state: c.state.toUpperCase(),
          zip: c.zip,
          country: "US",
        },
        tiers: d.services,
        five_plus: d.five_plus,
        card_count: d.five_plus ? d.card_count ?? null : d.cards.length,
        cards: d.five_plus
          ? []
          : d.cards.map((card) => ({
              name: card.name,
              details: card.details || null,
              service: card.service ?? (d.services.length === 1 ? d.services[0] : null),
            })),
        customer_notes: d.notes || null,
        terms_version_id: terms.id || null,
        terms_version: terms.version,
        signed_name: d.signing.signer_name,
        signed_text: signedText,
        signed_sha256: masterDocumentHash(terms.content_markdown, signedText),
        esign_consent: true,
        media_permission: d.signing.media,
        tag_permission: d.signing.media && d.signing.tag_name,
        ip_address: ip,
        user_agent: userAgent,
      })
      .select("dropoff_number")
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, dropoffNumber: data.dropoff_number });
  } catch (err) {
    console.error("Show drop-off not saved:", err instanceof Error ? err.message : err);
    await perEmail.release();
    await everyone.release();
    return Response.json({ error: "We couldn't save your drop-off. Please try again, or tell us at the table." }, { status: 500 });
  }
}
