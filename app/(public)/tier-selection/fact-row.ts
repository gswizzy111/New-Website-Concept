// One tier fact: label and value side by side, stacked when the card is too
// narrow for both (the facts list is the container, and cards in a row share
// a width, so a whole row switches together).
export const FACT_ROW =
  "flex flex-col gap-0.5 py-3 text-[15px] @min-[16.5rem]:flex-row @min-[16.5rem]:justify-between @min-[16.5rem]:gap-3";

// The plate a sold-out or closed tier shows instead of its button: a quiet,
// hatched pill the same height as the action.
export const CLOSED_ACTION =
  "flex min-h-[52px] w-full cursor-not-allowed items-center justify-center rounded-full bg-chalk px-5 font-display text-lg font-extrabold uppercase tracking-[0.05em] text-ink-soft shadow-[inset_0_0_0_1.5px_var(--line)] [background-image:repeating-linear-gradient(135deg,transparent_0_7px,rgba(13,18,51,0.05)_7px_10px)]";

// The "*" note on a tier's card value: a small ink tip on hover (mouse only),
// keyboard focus or a tap (data-open on the group).
export const TOOLTIP =
  "pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max max-w-[180px] rounded-lg bg-ink px-3 py-2 text-xs font-medium leading-snug text-white opacity-0 shadow-[var(--pop-shadow)] transition-opacity duration-150 [@media(hover:hover)]:group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-data-[open=true]:opacity-100";
