import { redirect } from "next/navigation";
import { ComposeForm } from "./compose-form";
import { loadBlastContacts, type SkipReason } from "./contacts";
import { ResendConfirmationsButton } from "@/app/admin/resend-confirmations-button";
import { isAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  Restoration: "Restoration",
  "Kit Order": "Kit Order",
  Both: "Both",
  Waitlist: "Waitlist",
  "Restoration Waitlist": "Resto Waitlist",
};

const SOURCE_COLORS: Record<string, string> = {
  Restoration: "bg-green-100 text-green-700",
  "Kit Order": "bg-blue-100 text-blue-700",
  Both: "bg-purple-100 text-purple-700",
  Waitlist: "bg-gray-100 text-gray-500",
  "Restoration Waitlist": "bg-amber-100 text-amber-700",
};

const SKIP_LABELS: Record<SkipReason, string> = {
  unsubscribed: "Unsubscribed",
  undeliverable: "Bounced or blocked",
  invalid: "Not a valid address",
};

export default async function EmailBlastPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const { contacts: all, listError } = await loadBlastContacts({ strict: false });
  const contacts = all.sort((a, b) => new Date(b.since).getTime() - new Date(a.since).getTime());
  const sendable = contacts.filter((c) => !c.skip).length;
  const skipped = contacts.length - sendable;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-6 py-10">

        <div className="mb-8">
          <h1 className="font-heading font-black text-3xl text-foreground">Email Blast</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {contacts.length} unique contacts across restoration orders, kit orders, and waitlists
          </p>
          {skipped > 0 && (
            <p className="text-muted-foreground text-sm mt-1">
              {skipped} skipped: unsubscribed, bounced or blocked, or not a valid address
            </p>
          )}
          {listError && (
            <p className="text-sm text-red-600 font-medium mt-2">
              Couldn&apos;t read the unsubscribe and bounce lists, so sending is off until they load: {listError}
            </p>
          )}
        </div>

        {/* Resend confirmation emails */}
        <div className="bg-white rounded-xl border border-border p-6 mb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h2 className="font-heading font-black text-lg text-foreground mb-1">Resend Order Confirmations</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Resends the order confirmation email (with shipping address / label) to every customer who paid today.
                Use this if your Resend limit was hit and some customers never received their confirmation.
              </p>
            </div>
            <div className="shrink-0">
              <ResendConfirmationsButton />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Compose panel */}
          <div className="order-2 lg:order-1">
            <ComposeForm totalEmails={sendable} blocked={!!listError} />
          </div>

          {/* Contact list */}
          <div className="order-1 lg:order-2">
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold text-foreground">All Contacts</h2>
                <span className="text-xs text-muted-foreground">{contacts.length} total</span>
              </div>

              <div className="overflow-y-auto max-h-[600px] divide-y divide-border">
                {contacts.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground text-sm">No contacts yet.</div>
                ) : (
                  contacts.map((c) => (
                    <div key={c.email} className="flex items-center justify-between px-5 py-3 gap-3">
                      <div className="min-w-0">
                        {c.name && (
                          <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                        )}
                        <p className="text-sm text-muted-foreground truncate">{c.email}</p>
                        {c.skip && (
                          <p className="text-xs text-red-600 font-medium">{SKIP_LABELS[c.skip]}: not sent</p>
                        )}
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${SOURCE_COLORS[c.source] ?? "bg-gray-100 text-gray-500"}`}>
                        {SOURCE_LABELS[c.source] ?? c.source}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
