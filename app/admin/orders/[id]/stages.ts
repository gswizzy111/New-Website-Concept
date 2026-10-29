/**
 * Per-card restoration stages (ported from the old site). Each change is an
 * order_events row, event_type "stage_update", described as
 * "Stage: <stage> [card:<card_id>]"; the newest one per card is its stage.
 */
export const STAGES = [
  "Ready for Slab Crack",
  "Humidor",
  "Humidity Press",
  "Book",
  "Heat Press",
  "Clamp Work",
  "Book with Weights",
  "Final Dry",
];

const STAGE_RE = /^Stage: (.+?) \[card:(.+)\]$/;

/** Each card's current stage, from the order's events (newest first). */
export function stagesByCard(events: { event_type: string; description: string | null }[]): Record<string, string> {
  const stageByCard: Record<string, string> = {};
  for (const e of events) {
    if (e.event_type !== "stage_update") continue;
    const m = STAGE_RE.exec(e.description ?? "");
    if (!m) continue;
    const [, stage, cardId] = m;
    if (!stageByCard[cardId]) stageByCard[cardId] = stage;
  }
  return stageByCard;
}
