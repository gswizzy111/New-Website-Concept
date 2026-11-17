import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ComplaintForm } from "./complaint-form";
import { CheckCircle2 } from "lucide-react";
import { Eyebrow, PortalHeader } from "@/components/account/portal";

export const dynamic = "force-dynamic";

export default async function CustomerComplaintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: c } = await admin
    .from("cases")
    .select("id, title, customer_name, customer_complaint, complaint_submitted_at, status")
    .eq("token", token)
    .single();

  if (!c) notFound();

  const alreadySubmitted = !!c.complaint_submitted_at;

  return (
    <div className="surface-chalk min-h-screen">
      <PortalHeader width="max-w-xl" label="Customer Support" sticky={false} />
      <div className="mx-auto w-full max-w-xl px-4 pt-10 pb-16 md:pt-14">
        <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
          <div className="border-b border-line px-6 py-6 sm:px-8">
            <Eyebrow>Support Case</Eyebrow>
            <h1 className="font-heading text-[2.25rem] leading-[0.95] font-black text-ink">{c.title}</h1>
            {c.customer_name && (
              <p className="mt-2 text-[15px] text-ink-soft">Hi {c.customer_name.split(" ")[0]},</p>
            )}
          </div>

          {alreadySubmitted ? (
            <div className="px-6 py-10 text-center sm:px-8">
              <span aria-hidden className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success-tint text-success">
                <CheckCircle2 className="size-7" strokeWidth={2} />
              </span>
              <p className="mb-2 font-heading text-[1.75rem] leading-none font-black text-ink">We received your complaint</p>
              <p className="text-[15px] leading-relaxed text-ink-soft">
                Thank you for reaching out. Our team will review your case and respond within <strong className="text-ink">3 business days</strong>.
                We&apos;ll be in touch by email.
              </p>
            </div>
          ) : (
            <div className="px-6 py-6 sm:px-8 sm:py-7">
              <p className="mb-5 text-[15px] leading-relaxed text-ink-soft">
                Please describe your complaint or concern in as much detail as possible. Our team reviews all submissions
                and will respond within <strong className="text-ink">3 business days</strong>.
              </p>
              <ComplaintForm caseId={c.id} token={token} />
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-soft">
          This link was sent to you directly by The Card Doc team. It is not publicly accessible.
        </p>
      </div>
    </div>
  );
}
