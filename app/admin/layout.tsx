import { createAdminClient } from "@/lib/supabase/admin";
import { AdminNav } from "./admin-nav";
import { InquiryAlert, RefundRequestAlert } from "./inquiry-alert";
import { pendingRefundRequestCount } from "@/lib/refund-requests";
import { getAdminSession } from "@/lib/admin-auth";
import { INQUIRY_TYPE, OPEN_CASE_STATUSES } from "@/lib/card-inquiries";
import { openProblemCount } from "@/lib/email-problems";
import { countUnseenCompletedBags } from "@/lib/intake/completed";
import { ViewAsButton } from "./view-as-button";
import { Inter, Playfair_Display } from "next/font/google";
import "./admin-legacy.css";

// The admin keeps thecarddoc1.com's look, unchanged, while the public site
// wears the redesign. Isolation: everything below renders inside
// <div class="admin-legacy"> (display: contents, so the layout is as before).
// That wrapper carries the old fonts (Inter body, Playfair Display headings,
// as thecarddoc1.com's root layout loaded them) and admin-legacy.css, which
// redefines every token the redesign changed (Tailwind's palette, the shadcn
// colours, --radius) on it and rolls back the redesign's global element
// rules (headings, focus ring, selection, native checkboxes, phone input
// size). Every rule there is scoped to .admin-legacy, so public pages never
// change. Admin files import the old shadcn components from
// components/admin-ui/ (copies of thecarddoc1.com's components/ui).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700", "900"],
});
const ADMIN_LOOK = `admin-legacy contents ${inter.variable} ${playfair.variable}`;

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  const role = session?.role ?? null;
  const isAdmin = role === "admin";
  const isSupport = role === "support";

  let openCaseCount = 0;
  let openInquiryCount = 0;
  let emailProblemCount = 0;
  let refundRequestCount = 0;
  let completedBagCount = 0;
  if (isAdmin || isSupport) {
    const admin = createAdminClient();
    // Support staff don't see internal cases, so they aren't in their count
    const openCases = admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_CASE_STATUSES);
    // One round trip for all the badges: every page and prefetch renders this
    // layout, so each extra wave of queries is felt everywhere
    const [{ count }, { count: inquiryCount }, problemCount, refundCount, bagCount] = await Promise.all([
      isSupport ? openCases.neq("type", "internal") : openCases,
      admin
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("type", INQUIRY_TYPE)
        .in("status", OPEN_CASE_STATUSES),
      openProblemCount(),
      // Refunds support asked for wait on an admin
      isAdmin ? pendingRefundRequestCount(admin) : 0,
      // Tier bags completed since anyone last looked (0 before the intake tables exist)
      isAdmin ? countUnseenCompletedBags().catch(() => 0) : 0,
    ]);
    openCaseCount = count ?? 0;
    openInquiryCount = inquiryCount ?? 0;
    emailProblemCount = problemCount;
    refundRequestCount = refundCount;
    completedBagCount = bagCount;
  }

  // Signed out (sign-in, forgot and reset password pages): no admin menu
  if (!role) return <div className={ADMIN_LOOK}><main className="min-h-screen">{children}</main></div>;

  return (
    <div className={ADMIN_LOOK}>
    <div className="flex min-h-screen">
      <AdminNav openCaseCount={openCaseCount} openUpdateRequestCount={openInquiryCount} emailProblemCount={emailProblemCount} completedBagCount={completedBagCount} role={role} username={session?.name ?? session?.username ?? null} />
      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        {session?.preview && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-900 px-6 py-3 text-sm font-semibold text-white">
            <span>👀 You&apos;re seeing the admin exactly as your support team does. Anything you do here is signed &ldquo;{session.username} (admin, viewing as support)&rdquo;.</span>
            <ViewAsButton to="admin" className="shrink-0 h-8 px-3 rounded-lg bg-white text-gray-900 text-xs font-bold disabled:opacity-60">
              Exit support view
            </ViewAsButton>
          </div>
        )}
        {isAdmin && <RefundRequestAlert count={refundRequestCount} />}
        <InquiryAlert count={openInquiryCount} />
        {children}
      </main>
    </div>
    </div>
  );
}
