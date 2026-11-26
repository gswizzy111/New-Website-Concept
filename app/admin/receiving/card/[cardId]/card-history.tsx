import { createAdminClient } from "@/lib/supabase/admin";
import { nyDateTime } from "@/lib/intake/tracking-format";
import type { StageHistoryEntry } from "@/lib/intake/types";
import { loadCardActivity, withDoneBy, type ActivityAction } from "@/lib/team-activity";
import { ActionList } from "@/app/admin/team/_components/action-list";

/**
 * The card page's history: the steps (Restoration history) with who did
 * each, then the moves, Take outs, Done and photos (lib/team-activity.ts
 * loadCardActivity: card_moves, card_photo_events, receiving events), each
 * "by <name>". The page shows `HistoryList` alone while this streams in.
 */

/** Lines already in the Restoration history (receipt, steps, rounds) aren't listed again under Moves. */
const IN_HISTORY = new Set<ActivityAction["kind"]>(["received", "step", "new_round"]);

export function HistoryList({ history }: { history: readonly StageHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No steps recorded yet.</p>;
  // Newest first
  const rows = [...history].reverse();
  return (
    <ol className="flex flex-col divide-y divide-border">
      {rows.map((h, i) => (
        <li key={`${h.at}-${h.kind}-${i}`} className="py-2.5 flex items-start gap-3">
          <span
            aria-hidden
            className={`mt-1.5 w-2.5 h-2.5 shrink-0 rounded-full ${
              h.kind === "completed" ? "bg-green-600" : h.kind === "received" ? "bg-blue-600" : h.kind === "round_started" ? "bg-amber-500" : "bg-purple-500"
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {h.label}
              {h.bulk && <span className="ml-2 text-[11px] font-bold text-muted-foreground">with its bag</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {nyDateTime(h.at)}
              {h.by ? <> · by <span className="font-semibold text-foreground">{h.by}</span></> : " · name not recorded"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const movesPanel = "bg-white rounded-xl border border-border pt-4 sm:pt-5 overflow-hidden";

export async function CardHistory({ cardId, history, panel }: { cardId: string; history: readonly StageHistoryEntry[]; panel: string }) {
  const load = await loadCardActivity(createAdminClient(), cardId);
  const actions = load.ok ? load.actions : [];
  const moves = actions.filter((a) => !IN_HISTORY.has(a.kind));
  return (
    <>
      <section className={panel} aria-labelledby="history">
        <h2 id="history" className="font-heading font-black text-base text-foreground mb-1">Restoration history</h2>
        <HistoryList history={withDoneBy(history, actions)} />
      </section>
      <section className={movesPanel} aria-labelledby="moves">
        <div className="px-4 sm:px-5">
          <h2 id="moves" className="font-heading font-black text-base text-foreground">Moves and photos</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">Where it went, Done, Take out and photos, newest first, with who did each.</p>
        </div>
        {!load.ok && <p role="alert" className="px-4 sm:px-5 pb-4 text-sm text-red-700">{load.error}</p>}
        {load.ok && load.notes.map((n) => <p key={n} role="status" className="px-4 sm:px-5 pb-2 text-xs text-amber-800">{n}</p>)}
        {load.ok && moves.length === 0 && <p className="px-4 sm:px-5 pb-4 text-sm text-muted-foreground">No moves recorded yet.</p>}
        {moves.length > 0 && (
          <div className="border-t border-border">
            <ActionList actions={moves} dir={new Map()} showCard={false} />
          </div>
        )}
      </section>
    </>
  );
}
