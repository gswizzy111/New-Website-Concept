import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, label: "Cards" },
  { n: 2, label: "Your Info" },
  { n: 3, label: "Shipping" },
  { n: 4, label: "Review" },
];

/**
 * The order's four steps on a rail that fills in cobalt as each one is done.
 * Done stops are cobalt with a check, the current stop is the sun disc.
 */
export function ProgressIndicator({ currentStep }: { currentStep: number }) {
  const done = Math.max(0, Math.min(STEPS.length - 1, currentStep - 1));
  return (
    <div className="relative w-full">
      {/* Rail, drawn between the first and last stop */}
      <div aria-hidden className="absolute top-[21px] right-[12.5%] left-[12.5%] h-1 overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full rounded-full bg-cobalt transition-[width] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ width: `${(done / (STEPS.length - 1)) * 100}%` }}
        />
      </div>
      <ol className="relative grid grid-cols-4">
        {STEPS.map((step) => {
          const state = step.n < currentStep ? "done" : step.n === currentStep ? "current" : "next";
          return (
            <li key={step.n} className="flex flex-col items-center gap-2.5" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "relative grid size-11 place-items-center rounded-full font-heading text-xl font-black tabular-nums transition-[background-color,color,box-shadow,transform] duration-300",
                  state === "done" && "bg-cobalt text-white shadow-[0_0_0_4px_var(--chalk)]",
                  state === "current" && "scale-110 bg-sun text-ink shadow-[0_0_0_4px_var(--chalk),0_0_0_6px_var(--ink)]",
                  state === "next" && "bg-white text-ink-soft shadow-[0_0_0_4px_var(--chalk),inset_0_0_0_1.5px_var(--line-strong)]"
                )}
              >
                {state === "done" ? <Check className="size-5" strokeWidth={3} /> : step.n}
              </span>
              <span
                className={cn(
                  "label-caps max-w-[9ch] text-center text-[15px] leading-tight sm:max-w-none",
                  state === "current" ? "text-ink" : "text-ink-soft"
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
