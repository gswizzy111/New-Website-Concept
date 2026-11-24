import { CircleCheck, ScanLine, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import type { ShelfGroup } from "../_lib/order-shelves";
import { placeLabelsUrl, scanHref } from "../_lib/places";
import { PlaceLabelButton } from "./print-buttons";

/**
 * The receiving workspace's "Put in shelf" box (right after Receive): for
 * each due date, the shelf slot its bags go in ("DUE MON DEC 7"), big, with
 * the shelf sign to print, the Scan page with the shelf already scanned (scan
 * the bag, then "Put all in ...") and the way to put cards in slots. Bags already on their shelf
 * show as one short line. Server component; the print button is a client part.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function PutInShelf({ groups }: { groups: ShelfGroup[] }) {
  if (!groups.length) return null;
  const todo = groups.filter((g) => !g.done);
  const shelved = groups.filter((g) => g.done);

  return (
    <section
      id="shelf"
      aria-labelledby="shelf-h"
      className={`mt-4 scroll-mt-20 lg:scroll-mt-6 rounded-xl bg-white p-4 sm:p-5 lining-nums ${todo.length ? "border-2 border-primary" : "border border-green-300"}`}
    >
      {todo.length > 0 ? (
        <>
          <p className="text-[11px] font-black uppercase tracking-widest text-primary">Next step</p>
          <h3 id="shelf-h" className="font-heading font-black text-xl text-foreground">Put each bag in its shelf</h3>

          <ul className="mt-3 flex flex-col gap-3">
            {todo.map((g) => (
              <li key={g.dueDate ?? "none"} className={`rounded-xl border-2 p-4 sm:p-5 ${g.place ? "border-foreground bg-secondary/40" : "border-amber-400 bg-amber-50"}`}>
                {g.place ? (
                  <>
                    <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Put in shelf</p>
                    <p className="font-heading font-black text-4xl sm:text-5xl leading-none tracking-tight text-foreground [overflow-wrap:anywhere]">{g.place.name}</p>
                    <p className="mt-1 font-mono text-xs font-semibold text-muted-foreground">{g.place.code}</p>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-amber-800">
                      <TriangleAlert aria-hidden className="size-4" strokeWidth={1.75} />
                      No due date yet
                    </p>
                    <p className="mt-1 text-sm font-semibold text-amber-900">These bags need a due date before they get a shelf. Set it on the bag page.</p>
                  </>
                )}
                <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Bags">
                  {g.bags.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                      <AdminLink href={`/admin/receiving/bag/${b.id}${g.place ? "" : "#due"}`} className={`font-mono font-black text-foreground hover:text-primary hover:underline rounded ${focusRing}`}>
                        {b.code}
                      </AdminLink>
                      <span className="text-muted-foreground">{b.tierName} · {b.toShelve} card{b.toShelve === 1 ? "" : "s"}{b.onShelf ? ` · ${b.onShelf} already on the shelf` : ""}</span>
                    </li>
                  ))}
                </ul>
                {g.place && (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <AdminLink
                      href={scanHref(g.place.code)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 ${focusRing}`}
                    >
                      <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
                      Scan the shelf, then the bag
                    </AdminLink>
                    {g.place.id && (
                      <PlaceLabelButton pdfUrl={placeLabelsUrl({ ids: [g.place.id] })} fileName={`${g.place.code}-sign.pdf`}>
                        Print shelf sign
                      </PlaceLabelButton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <h3 id="shelf-h" className="sr-only">Shelf</h3>
      )}

      {shelved.length > 0 && (
        <ul className={`flex flex-col gap-1.5 ${todo.length ? "mt-4 pt-3 border-t border-border" : ""}`} aria-label="On the shelf">
          {shelved.map((g) => (
            <li key={g.dueDate ?? "none"} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <CircleCheck aria-hidden className="size-4 text-green-700" strokeWidth={1.75} />
              <span className="font-bold text-green-800">On shelf {g.place?.name}</span>
              <span className="text-muted-foreground">
                {g.bags.map((b) => `${b.code} (${b.onShelf} card${b.onShelf === 1 ? "" : "s"})`).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${todo.length || shelved.length ? "mt-4 pt-3 border-t border-border" : ""}`}>
        <p className="text-sm text-muted-foreground">
          When a card goes to a station: scan the slot&apos;s QR (CLAMP 07), then the bag&apos;s label, and tap the card.
        </p>
        <AdminLink
          href="/admin/scan"
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-foreground hover:border-primary/40 ${focusRing}`}
        >
          <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
          Put cards in slots
        </AdminLink>
      </div>
    </section>
  );
}
