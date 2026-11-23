import { STAGES, adminStageLabel } from "@/lib/restoration-stages";

export type StageState = "done" | "current" | "remaining";

/**
 * Where each of the 8 restoration steps stands for one card: steps before the
 * current one are done, the current one is current, the rest remain. A
 * completed card has every step done; a card with no stage yet has none.
 */
export function stageStates(currentStage: string | null | undefined, completed: boolean): StageState[] {
  if (completed) return STAGES.map(() => "done");
  const idx = currentStage ? (STAGES as readonly string[]).indexOf(currentStage) : -1;
  return STAGES.map((_, i) => (i < idx ? "done" : i === idx ? "current" : "remaining"));
}

/** The step after `stage` (null = not started → the first step); null after the last step. */
export function nextStage(stage: string | null | undefined): string | null {
  if (!stage) return STAGES[0];
  const idx = (STAGES as readonly string[]).indexOf(stage);
  if (idx < 0) return STAGES[0];
  return idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
}

/** The label of the one big advance button: "Move to Humidor", or from the last step "Mark card done". */
export function advanceLabel(stage: string | null | undefined, cards = 1): string {
  const next = nextStage(stage);
  if (cards === 1) return next ? `Move to ${adminStageLabel(next)}` : "Mark card done";
  return next ? `Move these ${cards} cards to ${adminStageLabel(next)}` : `Mark these ${cards} cards done`;
}

/** "Step 3 of 8 · Humidity Press", "Not started" or "Done". */
export function stageSummary(stage: string | null | undefined, completed: boolean): string {
  if (completed) return "Done";
  const idx = stage ? (STAGES as readonly string[]).indexOf(stage) : -1;
  if (idx < 0) return "Not started";
  return `Step ${idx + 1} of ${STAGES.length} · ${adminStageLabel(stage!)}`;
}

/**
 * The 8 restoration steps of one card (lib/restoration-stages.ts) with done,
 * current and remaining states. "list" is the full track on a card page;
 * "bar" is 8 small segments for a row in a list.
 */
export function StageTrack({
  stage,
  completed,
  round = 1,
  variant = "list",
}: {
  stage: string | null | undefined;
  completed: boolean;
  round?: number;
  variant?: "list" | "bar";
}) {
  const states = stageStates(stage, completed);

  if (variant === "bar") {
    return (
      <div className="flex items-center gap-1" role="img" aria-label={`${stageSummary(stage, completed)}${round > 1 ? `, round ${round}` : ""}`}>
        {states.map((s, i) => (
          <span
            key={STAGES[i]}
            className={`h-1.5 flex-1 min-w-2 rounded-full ${
              s === "done" ? "bg-purple-300" : s === "current" ? "bg-purple-600" : "bg-muted"
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      {round > 1 && (
        <p className="mb-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-600 text-white">Round {round}</span>
        </p>
      )}
      <ol className="flex flex-col gap-1.5">
        {STAGES.map((name, i) => {
          const s = states[i];
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
