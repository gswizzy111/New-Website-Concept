import type { Metadata } from "next";
import Link from "next/link";
import { MailWarning } from "lucide-react";
import { lookupUnsubscribeToken } from "@/lib/email-unsubscribe";
import { UnsubscribePanel } from "./unsubscribe-panel";

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
    <div className="page-glow flex flex-1 flex-col min-h-screen">
      <div className="max-w-7xl w-full mx-auto px-4 md:px-10 py-5">
        <Link href="/" className="inline-flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/card-doctor.jpg" alt="" className="w-9 h-9 rounded-md object-cover ring-1 ring-rule" />
          <span className="font-heading text-lg tracking-[-0.01em] text-ink">The Card Doc</span>
        </Link>
      </div>
      <div className="flex flex-1 items-center">
        <div className="max-w-xl w-full mx-auto px-4 md:px-10 py-16 md:py-28">
          {found ? (
            <UnsubscribePanel token={token} email={found.email} alreadyUnsubscribed={found.unsubscribed} />
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-rx-soft text-rx mb-6">
                <MailWarning className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <h1 className="font-heading text-3xl md:text-4xl font-extrabold tracking-[-0.015em] text-ink mb-4">
                {failed ? "Something went wrong" : "This link isn't valid"}
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {failed
                  ? "We couldn't open your unsubscribe link just now. Please try again in a minute."
                  : "Open the unsubscribe link from the email again, or reply to that email and we'll take you off the list."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
