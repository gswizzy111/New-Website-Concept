import { z } from "zod";
import { effectiveTier, tierDisplayName } from "@/lib/intake/codes";
import { toNyDate, isDay } from "@/lib/intake/business-days";
import { SETUP_STATUSES, type CardRef, type OrderPlan, type PlanInput } from "@/lib/intake/migration";
import { cleanSearch, statusLabel } from "@/lib/support-view";
import type { SetupOrderRow } from "./store";

/** Filters of the order list (query string) and of "Select all eligible" (preview body). */
export const SetupFilters = z.object({
  status: z.enum(["all", ...SETUP_STATUSES] as const).catch("all"),
  show: z.enum(["needs", "done", "all"]).catch("needs"),
  from: z.string().refine(isDay).optional().catch(undefined),
  to: z.string().refine(isDay).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
});
export type SetupFilters = z.infer<typeof SetupFilters>;

export type SetupState = "needs_setup" | "set_up" | "error";

export const stateOf = (p: OrderPlan): SetupState => (p.errors.length ? "error" : p.alreadySetUp ? "set_up" : "needs_setup");

/** Does an order pass the filters? Only orders the setup can work on are listed. */
export function matches(order: SetupOrderRow, plan: OrderPlan, input: PlanInput | undefined, f: SetupFilters): boolean {
  if (!plan.eligible) return false;
  if (f.status !== "all" && order.status !== f.status) return false;
  const state = stateOf(plan);
  if (f.show === "needs" && state === "set_up") return false;
  if (f.show === "done" && state !== "set_up") return false;
  const day = toNyDate(order.created_at);
  if (f.from && (!day || day < f.from)) return false;
  if (f.to && (!day || day > f.to)) return false;
  const q = cleanSearch(f.q).toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const number = (order.order_number ?? "").toLowerCase();
    const hay = [number, order.customer_name ?? "", order.customer_email ?? "", ...(input?.cards ?? []).map((c) => c.card_code ?? "")]
      .join(" ").toLowerCase();
    const byNumber = digits.length >= 3 && number.replace(/\D/g, "") === digits;
    if (!byNumber && !hay.includes(q)) return false;
  }
  return true;
}

export type SetupCardView = {
  id: string;
  code: string | null;
  planned: boolean;
  name: string;
  detail: string;
  tierName: string;
  bagCode: string | null;
  missingImage: boolean;
  missingTier: boolean;
  completed: boolean;
  refunded: boolean;
  awaiting: boolean;
};

export type SetupOrderView = {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  status: string;
  statusLabel: string;
  createdAt: string;
  receivedOn: string | null;
  receivedSource: "event" | "dropoff" | null;
  state: SetupState;
  cardCount: number;
  cards: SetupCardView[];
  changes: { cardsToUpdate: number; cardCodes: number; newBags: string[]; bagFills: number };
  issues: { missingImages: number; missingTiers: number; missingReceivedDate: boolean; finishedDateUnknown: boolean; errors: string[] };
};

/** One order as the setup list shows it (cards by number). */
export function orderView(order: SetupOrderRow, plan: OrderPlan, input: PlanInput): SetupOrderView {
  const planned = new Map(plan.cardCodes.map((c) => [c.cardId, c]));
  const plannedBag = new Map(plan.links.map((l) => [l.cardId, l.bagCode]));
  const bagCode = new Map(input.bags.map((b) => [b.id, b.bag_code]));
  const missingImage = new Set(plan.missingImages.map((r) => r.cardId));
  const missingTier = new Set(plan.missingTiers.map((r) => r.cardId));
  const cards = input.cards
    .map((c) => {
      const seq = c.card_seq ?? planned.get(c.id)?.seq ?? null;
      return {
        seq,
        view: {
          id: c.id,
          code: c.card_code ?? planned.get(c.id)?.code ?? null,
          planned: !c.card_code && planned.has(c.id),
          name: c.card_name?.trim() || "Unnamed card",
          detail: [c.card_set, c.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" · "),
          tierName: tierDisplayName(effectiveTier(c.tier, order.restoration_tier)),
          bagCode: (c.bag_id ? bagCode.get(c.bag_id) : null) ?? plannedBag.get(c.id) ?? null,
          missingImage: missingImage.has(c.id),
          missingTier: missingTier.has(c.id),
          completed: !!c.completed,
          refunded: c.status === "refunded",
          awaiting: !!c.awaiting_arrival,
        } satisfies SetupCardView,
      };
    })
    .sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9))
    .map((x) => x.view);
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    status: order.status,
    statusLabel: statusLabel(order.status),
    createdAt: order.created_at,
    receivedOn: plan.receivedOn,
    receivedSource: plan.receivedSource,
    state: stateOf(plan),
    cardCount: input.cards.length,
    cards,
    changes: {
      cardsToUpdate: plan.cardsToUpdate,
      cardCodes: plan.cardCodes.length,
      newBags: plan.newBags.map((b) => b.bagCode),
      bagFills: plan.bagFills.length,
    },
    issues: {
      missingImages: plan.missingImages.length,
      missingTiers: plan.missingTiers.length,
      missingReceivedDate: plan.missingReceivedDate,
      finishedDateUnknown: plan.finishedDateUnknown,
      errors: plan.errors,
    },
  };
}

export type IssueOrder = { orderId: string; orderNumber: string | null; customerName: string | null; status: string; cards: CardRef[] };
