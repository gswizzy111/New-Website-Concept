import type { Metadata } from "next";
import { MailWarning } from "lucide-react";
import { lookupUnsubscribeToken } from "@/lib/email-unsubscribe";
import { UnsubscribePanel } from "./unsubscribe-panel";
import { PortalHeader } from "@/components/account/portal";

// The token is in this page's address: never pass it on to other pages or sites
export const metadata: Metadata = {
  title: "Unsubscribe | The Card Doc",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The unsubscribe link at the bottom of every Email Blast
 * (lib/email-unsubscribe.ts). Works without signing in. Unsubscribing takes a
 * button press, not the page load, so email scanners that open links can't
 * unsubscribe anyone.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.trim() : "";

  let found: { email: string; unsubscribed: boolean } | null = null;
  let failed = false;
  try {
    found = token ? await lookupUnsubscribeToken(token) : null;
  } catch (err) {
    console.error("Unsubscribe page lookup failed:", err instanceof Error ? err.message : err);
    failed = true;
  }

  return (
    <div className="surface-chalk flex min-h-screen flex-1 flex-col">
      <PortalHeader width="max-w-3xl" sticky={false} />
      <div className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-xl px-4 py-16 md:py-28">
          <div className="rounded-[22px] bg-white px-6 py-8 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] md:px-10 md:py-10">
          {found ? (
            <UnsubscribePanel token={token} email={found.email} alreadyUnsubscribed={found.unsubscribed} />
          ) : (
            <>
              <span className="mb-6 flex size-14 items-center justify-center rounded-[18px] bg-cobalt-wash text-cobalt">
                <MailWarning className="size-7" strokeWidth={1.75} aria-hidden />
              </span>
              <h1 className="mb-4 font-heading text-[2.25rem] leading-[0.95] font-black text-ink md:text-[2.75rem]">
                {failed ? "Something went wrong" : "This link isn't valid"}
              </h1>
              <p className="text-[17px] leading-relaxed text-ink-soft">
                {failed
                  ? "We couldn't open your unsubscribe link just now. Please try again in a minute."
                  : "Open the unsubscribe link from the email again, or reply to that email and we'll take you off the list."}
              </p>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
