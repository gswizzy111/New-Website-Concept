import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import type { CardStageState } from "@/lib/intake/types";

type TrackState = Pick<CardStageState, "currentIndex" | "completed" | "round" | "currentLabel" | "doneStages">;

/**
 * The 8 restoration steps of one card (STAGES in lib/restoration-stages.ts)
 * as done, current or remaining, from the card's stage state
 * (cardStageState() in lib/intake/stage-plan.ts). Steps are taken in any
 * order, so "done" is a step reached this round (doneStages), not every step
 * before the current one. "list" is the full track; "bar" is 8 small
 * segments for a row in a list.
 */
export function StageTrack({ state, variant = "list" }: { state: TrackState; variant?: "list" | "bar" }) {
  // currentIndex: -1 not started, 0-7 the current step, 8 (STAGES.length) done
  const status = (i: number) =>
    i === state.currentIndex ? "current" : state.completed || state.doneStages.includes(STAGES[i]) ? "done" : "remaining";

  if (variant === "bar") {
    const where = state.completed
      ? "Done"
      : state.currentIndex < 0
      ? "Not started"
      : `Step ${state.currentIndex + 1} of ${STAGES.length}: ${state.currentLabel}`;
    return (
      <div className="flex items-center gap-1" role="img" aria-label={`${where}${state.round > 1 ? `, round ${state.round}` : ""}`}>
        {STAGES.map((name, i) => {
          const s = status(i);
          return (
            <span
              key={name}
              className={`h-1.5 flex-1 min-w-2 rounded-full ${s === "done" ? "bg-purple-300" : s === "current" ? "bg-purple-600" : "bg-muted"}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {state.round > 1 && (
        <p className="mb-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-600 text-white">Round {state.round}</span>
        </p>
      )}
      <ol className="flex flex-col gap-1.5">
        {STAGES.map((name, i) => {
          const s = status(i);
          return (
            <li
              key={name}
              aria-current={s === "current" ? "step" : undefined}
              className={`flex items-center gap-3 rounded-lg border px-3 min-h-11 ${
                s === "current"
                  ? "bg-purple-600 border-purple-600 text-white"
                  : s === "done"
                  ? "bg-purple-50 border-purple-100 text-purple-700"
                  : "bg-white border-border text-muted-foreground"
              }`}
            >
              <span
                aria-hidden
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  s === "current" ? "bg-white text-purple-700" : s === "done" ? "bg-purple-300 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {s === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${s === "current" ? "font-bold" : "font-medium"}`}>{adminStageLabel(name)}</span>
              <span className="ml-auto text-[11px] font-bold uppercase tracking-wide">
                {s === "done" ? "Done" : s === "current" ? "Now" : <span className="sr-only">To do</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
