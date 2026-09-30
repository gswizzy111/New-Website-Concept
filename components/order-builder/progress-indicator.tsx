import { Check } from "lucide-react";
const STEPS = [
  { n: 1, label: "Cards" },
  { n: 2, label: "Your Info" },
  { n: 3, label: "Shipping" },
  { n: 4, label: "Review" },
];

export function ProgressIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-0 w-full">
      {STEPS.map((step, i) => (
        <div key={step.n} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-md flex items-center justify-center font-mono text-xs transition-colors duration-200 ${
                step.n < currentStep
                  ? "bg-primary text-primary-foreground"
                  : step.n === currentStep
                  ? "bg-ink text-paper"
                  : "bg-white text-muted-foreground ring-1 ring-rule"
              }`}
            >
              {step.n < currentStep ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.n}
            </div>
            <span
              className={`rx-label !normal-case !tracking-normal !text-xs hidden sm:block ${
                step.n === currentStep
                  ? "!text-ink font-semibold"
                  : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`h-px flex-1 mx-2 transition-colors ${
                step.n < currentStep ? "bg-primary" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
