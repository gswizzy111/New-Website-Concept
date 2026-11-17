/**
 * The agreements signed for an order (order_agreements): who signed, when,
 * for which cards, and the exact text they agreed to.
 */
export type SignedAgreement = {
  id: string;
  kind: "slab_removal" | "high_value";
  version: string;
  signer_name: string;
  signed_at: string;
  card_name: string | null;
  declared_value_cents: number | null;
  cards: string[] | number | null;
  agreement_text: string;
  ip?: string | null;
};

const TITLES = { slab_removal: "Slab-Removal Authorization", high_value: "High-Value Card Agreement" } as const;

function forWhat(a: SignedAgreement) {
  if (a.kind === "high_value") {
    const v = a.declared_value_cents != null ? ` · declared $${(a.declared_value_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
    return `${a.card_name ?? "Card"}${v}`;
  }
  if (typeof a.cards === "number") return `${a.cards} slabbed card${a.cards === 1 ? "" : "s"}`;
  return Array.isArray(a.cards) ? a.cards.join(", ") : "";
}

export function SignedAgreements({ agreements, showIp = false }: { agreements: SignedAgreement[]; showIp?: boolean }) {
  if (!agreements.length) return null;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {agreements.map((a) => (
        <li key={a.id} className="py-3 first:pt-0 last:pb-0">
          <p className="text-sm font-bold text-foreground">{TITLES[a.kind]}</p>
          <p className="text-xs text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">{forWhat(a)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Signed by <span className="font-medium text-foreground">{a.signer_name}</span> on{" "}
            {new Date(a.signed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET
            {showIp && a.ip ? ` · ${a.ip}` : ""} · version {a.version}
          </p>
          <details className="mt-1.5">
            <summary className="inline-flex min-h-9 cursor-pointer items-center text-xs font-bold text-cobalt underline decoration-[1.5px] underline-offset-4 hover:text-ink">Show what was signed</summary>
            <p className="mt-2 whitespace-pre-line rounded-[12px] bg-chalk p-4 text-xs leading-relaxed text-ink-soft shadow-[inset_0_0_0_1px_var(--line)]">{a.agreement_text}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
