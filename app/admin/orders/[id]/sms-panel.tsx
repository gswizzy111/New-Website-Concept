import { Suspense } from "react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { Skeleton } from "@/components/admin-ui/skeleton";
import { smsConfigured } from "@/lib/sms/config";
import { smsForOrder } from "@/lib/sms/messages";
import { formatPhone } from "@/lib/sms/phone";
import { consentSourceLabel, smsKindLabel, smsStatusBadge, smsWhen } from "@/app/admin/texts/_components/text-helpers";

/**
 * The order page's "Text updates" card (lib/sms): whether the customer agreed
 * to order texts, the number, when and where they agreed, whether it replied
 * STOP, and each text with its status. Streams in on its own (Suspense), so
 * the order page never waits on it, and any problem reading it shows here
 * instead of breaking the page.
 */
export function SmsPanel({ orderId }: { orderId: string }) {
  return (
    <Suspense fallback={<SmsPanelShell><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-28 mt-2" /></SmsPanelShell>}>
      <SmsPanelBody orderId={orderId} />
    </Suspense>
  );
}

function SmsPanelShell({ badge, children }: { badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-heading font-black text-lg text-foreground">Text updates</h2>
        {badge}
      </div>
      {children}
    </div>
  );
}

function OnOff({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${on ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
      {label ?? (on ? "On" : "Off")}
    </span>
  );
}

async function SmsPanelBody({ orderId }: { orderId: string }) {
  let sms: Awaited<ReturnType<typeof smsForOrder>>;
  try {
    sms = await smsForOrder(orderId);
  } catch (err) {
    console.error("[sms] order panel:", err instanceof Error ? err.message : err);
    return (
      <SmsPanelShell>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this order&apos;s texts. Reload the page to try again.</p>
      </SmsPanelShell>
    );
  }

  if (!sms.setUp) {
    return (
      <SmsPanelShell badge={<OnOff on={false} />}>
        <p className="text-sm text-muted-foreground">Texts aren&apos;t set up yet.</p>
        <AdminLink href="/admin/texts" className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">See Texts setup</AdminLink>
      </SmsPanelShell>
    );
  }

  const { consent, optedOut, messages } = sms;
  const on = !!consent && !optedOut;
  const sending = smsConfigured();

  return (
    <SmsPanelShell badge={<OnOff on={on} label={optedOut ? "Opted out" : undefined} />}>
      {consent ? (
        <div className="text-sm space-y-0.5">
          <p className="font-medium text-foreground">{formatPhone(consent.phone)}</p>
          <p className="text-xs text-muted-foreground">
            Agreed {smsWhen(consent.createdAt)} at {consentSourceLabel(consent.source)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The customer didn&apos;t opt in to text updates for this order.</p>
      )}

      {optedOut && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          This number replied STOP, so it gets no more texts. If they reply START, texts turn back on.
        </p>
      )}

      {consent && !sending && (
        <p className="mt-3 text-xs text-amber-700">Sending is off until Telnyx is set up. A text that waits more than 24 hours is dropped, never sent late.</p>
      )}

      {messages.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-border pt-3">
          {messages.map((m) => {
            const badge = smsStatusBadge(m.status);
            const when = m.delivered_at ?? m.sent_at ?? m.created_at;
            return (
              <li key={m.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{smsKindLabel(m.kind)}</span>
                  <span title={badge.hint} className={`shrink-0 font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                </div>
                <p className="text-muted-foreground mt-0.5">
                  {smsWhen(when)}
                  {m.status === "queued" && m.send_after && Date.parse(m.send_after) > Date.now() ? ` · goes out ${smsWhen(m.send_after)}` : ""}
                </p>
                {m.skip_reason && <p className="text-muted-foreground mt-0.5">{m.skip_reason}</p>}
                {m.error && <p className="text-red-700 mt-0.5 font-mono break-words">{m.error}</p>}
                {m.body && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Text</summary>
                    <p className="mt-1 text-foreground whitespace-pre-wrap break-words">{m.body}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AdminLink href="/admin/texts" className="mt-4 inline-block text-xs font-semibold text-primary hover:underline">All texts and replies</AdminLink>
    </SmsPanelShell>
  );
}
