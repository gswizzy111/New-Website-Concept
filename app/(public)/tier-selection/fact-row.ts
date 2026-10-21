// One tier fact: label and value side by side, stacked when the card is too
// narrow for both (the facts list is the container, and cards in a row share
// a width, so a whole row switches together).
export const FACT_ROW =
  "flex flex-col gap-0.5 py-2.5 text-sm @min-[16.5rem]:flex-row @min-[16.5rem]:justify-between @min-[16.5rem]:gap-3";
