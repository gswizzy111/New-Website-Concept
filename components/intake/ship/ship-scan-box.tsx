"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CircleAlert, CircleCheck, Info, LoaderCircle, ScanLine, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { codeKind, normalizeCode } from "@/lib/intake/codes";
import { shipScanIntent, type ShipRowStatus } from "./rules";
import { SHIP_LOCATION, moveTo, scanFeedback } from "./move-client";
import type { MoveResultItem } from "@/lib/intake/tracking/types";

/**
 * The ship check page's scan box. A handheld scanner (it types the QR link
 * or code, then Enter) or typing works; each card of this order scanned here
 * is moved to Shipping (POST /api/admin/track/move, LOC-SHIP), which is the
 * "it's really here" tick. A bag asks first (scanning each card is the
 * check); cards of another order, place signs and the order's own code are
 * refused without saving anything. Scans are handled one after another, so a
 * fast scanner never loses one. The list above refreshes after each save.
 */

type Tone = "pending" | "good" | "warn" | "bad" | "info";
type FeedItem = { id: number; tone: Tone; text: string; bag?: { code: string; cardCount: number } };

const TONE: Record<Tone, { box: string; icon: React.ReactNode }> = {
  pending: { box: "border-border bg-white text-muted-foreground", icon: <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /> },
  good: { box: "border-green-200 bg-green-50 text-green-900", icon: <CircleCheck aria-hidden className="size-5 text-green-700" strokeWidth={1.75} /> },
  warn: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: <TriangleAlert aria-hidden className="size-5 text-amber-700" strokeWidth={1.75} /> },
  bad: { box: "border-red-200 bg-red-50 text-red-800", icon: <CircleAlert aria-hidden className="size-5 text-red-700" strokeWidth={1.75} /> },
  info: { box: "border-blue-200 bg-blue-50 text-blue-900", icon: <Info aria-hidden className="size-5 text-blue-700" strokeWidth={1.75} /> },
};

const SHOWN = 6;

export function ShipScanBox({
  orderNumber,
  cards,
  bags,
  cameraHref,
}: {
  orderNumber: string;
  /** This order's cards that have a Card ID, with their status now. */
  cards: { code: string; done: boolean; status: ShipRowStatus }[];
  bags: { code: string; cardCount: number }[];
  /** The Scan page at Shipping, for the phone camera. */
  cameraHref: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextId = useRef(1);
  // The latest statuses (props change after each refresh); read when a queued scan runs
  const latest = useRef({ cards, bags });
  useEffect(() => {
    latest.current = { cards, bags };
  }, [cards, bags]);

  // A desk with a handheld scanner wants the box ready; a phone keeps its keyboard closed
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) input.current?.focus();
  }, []);

  function push(item: Omit<FeedItem, "id">): number {
    const id = nextId.current++;
    setFeed((f) => [{ ...item, id }, ...f].slice(0, SHOWN));
    return id;
  }
  function update(id: number, patch: Omit<FeedItem, "id">) {
    setFeed((f) => f.map((x) => (x.id === id ? { ...patch, id } : x)));
  }
  function done(id: number, tone: Exclude<Tone, "pending">, text: string, bag?: FeedItem["bag"]) {
    update(id, { tone, text, bag });
    scanFeedback(tone === "good" ? "good" : tone === "bad" ? "bad" : "warn");
  }
  const refresh = () => startTransition(() => router.refresh());

  /** Moves a card or bag to Shipping; the result, or null after showing why not. */
  async function moveCards(id: number, code: string, label: string): Promise<MoveResultItem | null> {
    const out = await moveTo(SHIP_LOCATION, [code]);
    if (!out.ok) {
      done(id, "bad", `${label}: ${out.error}`);
      return null;
    }
    const r = out.result;
    if (!r?.ok) {
      done(id, "bad", r?.message || `${label} wasn't moved.`);
      return null;
    }
    refresh();
    return r;
  }

  async function handle(raw: string) {
    const code = normalizeCode(raw);
    const { cards: now, bags: bagList } = latest.current;
    const intent = shipScanIntent(code, code ? codeKind(code) : null, {
      orderNumber,
      cardCodes: now.map((c) => c.code),
      bagCodes: bagList.map((b) => b.code),
    });
    const id = push({ tone: "pending", text: `Checking ${code || raw.trim().slice(0, 40)}…` });

    if (intent.kind === "not_a_code") return done(id, "bad", "That isn't a Card ID. Scan the card sticker's QR, or type its Card ID (CD-2549-03).");
    if (intent.kind === "place") return done(id, "info", `${intent.code} is a place sign. Scan the cards themselves.`);
    if (intent.kind === "this_order") return done(id, "info", `That's the order code (${orderNumber}). Scan each card, so a forgotten one shows up.`);
    if (intent.kind === "other_order") return done(id, "bad", `${intent.code} isn't in order ${orderNumber}. Put it aside: nothing was moved.`);
    if (intent.kind === "bag") {
      const bag = bagList.find((b) => b.code.toUpperCase() === intent.code);
      const n = bag?.cardCount ?? 0;
      return done(id, "info", `Bag ${intent.code}: scan each card in it to check it's really there, or move all ${n} card${n === 1 ? "" : "s"} at once.`, { code: intent.code, cardCount: n });
    }

    const card = now.find((c) => c.code.toUpperCase() === intent.code);
    if (card?.status === "ok") return done(id, "good", `${intent.code} is already checked: done and at Shipping.`);
    const r = await moveCards(id, intent.code, intent.code);
    if (!r) return;
    if (card && !card.done) done(id, "warn", `${intent.code} is at Shipping, but it isn't marked done. Check it's finished, then tap Mark done below.`);
    else done(id, "good", `${intent.code} checked: done and at Shipping.`);
  }

  async function moveBag(item: FeedItem) {
    if (!item.bag) return;
    const { code, cardCount } = item.bag;
    update(item.id, { tone: "pending", text: `Moving bag ${code} to Shipping…` });
    const r = await moveCards(item.id, code, `Bag ${code}`);
    if (!r) return;
    done(item.id, "good", r.message || `Bag ${code}: ${cardCount} card${cardCount === 1 ? "" : "s"} moved to Shipping.`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    setValue("");
    if (!raw) return;
    queue.current = queue.current.then(() => handle(raw)).catch(() => undefined);
  }

  return (
    <section aria-labelledby="ship-scan" className="rounded-xl border-2 border-primary/30 bg-white p-4 sm:p-5">
      <h2 id="ship-scan" className="font-heading font-black text-lg text-foreground flex items-center gap-2">
        <ScanLine aria-hidden className="size-5" strokeWidth={1.75} />
        Scan each card
      </h2>
      <p className="text-sm text-muted-foreground mt-0.5">
        Scan every card going in the box. Each one scanned here gets a tick: done and at Shipping.
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label htmlFor="ship-scan-input" className="sr-only">Card ID or scanned QR</label>
        <input
          ref={input}
          id="ship-scan-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Scan or type a Card ID"
          className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-border bg-white font-mono text-base outline-none focus:border-primary transition-colors"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button
          type="submit"
          className="h-12 px-4 sm:px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Check
        </button>
      </form>
      <AdminLink
        href={cameraHref}
        className="mt-2 inline-flex items-center gap-1.5 min-h-11 text-sm font-semibold text-primary hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Camera aria-hidden className="size-4" strokeWidth={1.75} />
        Use the phone camera (Scan page, at Shipping)
      </AdminLink>

      {feed.length > 0 && (
        <ul aria-live="polite" className="mt-3 flex flex-col gap-2">
          {feed.map((item) => (
            <li key={item.id} className={`rounded-lg border px-3 py-2.5 text-sm ${TONE[item.tone].box}`}>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-px">{TONE[item.tone].icon}</span>
                <p className="min-w-0 break-words [overflow-wrap:anywhere]">{item.text}</p>
              </div>
              {item.bag && item.tone === "info" && item.bag.cardCount > 0 && (
                <button
                  type="button"
                  onClick={() => moveBag(item)}
                  className="mt-2 min-h-11 px-3 rounded-lg border border-blue-300 bg-white text-sm font-bold text-blue-900 hover:bg-blue-100 transition-colors"
                >
                  Move all {item.bag.cardCount} in {item.bag.code} to Shipping
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
