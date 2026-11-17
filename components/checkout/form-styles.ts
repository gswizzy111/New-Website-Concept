/**
 * The shared look of every checkout form (restoration builder, prep, add
 * cards, kit checkout): white 22px panels on chalk, Big Shoulders headings,
 * and selectable "choice" tiles that turn cobalt-wash with a cobalt edge when
 * picked. Class strings only, so each form keeps its own markup and logic.
 */

/** A white form panel (22px corners, hairline, soft shadow). */
export const FORM_PANEL =
  "rounded-[22px] bg-white p-5 text-ink shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:p-7";

/** A quieter inset block inside a panel (chalk fill, 14px corners). */
export const INSET = "rounded-[14px] bg-chalk p-4 text-ink";

/** A step's headline ("Tell us about your cards."). */
export const STEP_TITLE =
  "font-heading text-[2.5rem] font-black leading-[0.92] tracking-[-0.01em] text-ink md:text-[3.25rem]";

/** A panel's headline ("Order Summary", "Contact"). */
export const BLOCK_TITLE = "font-heading text-[1.625rem] font-extrabold leading-none text-ink md:text-[1.75rem]";

/** A small Big Shoulders caps label ("Shipping speed", "Status"). */
export const MINI_LABEL = "label-caps text-[15px] text-ink-soft";

/** A selectable tile: a radio-like card, a tier, a rate. */
export const CHOICE =
  "rounded-[14px] bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] transition-[background-color,box-shadow] duration-150 hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]";
/** The picked state of a CHOICE tile. */
export const CHOICE_ON =
  "bg-cobalt-wash shadow-[inset_0_0_0_2px_var(--cobalt)] hover:shadow-[inset_0_0_0_2px_var(--cobalt)]";
/** Focus ring for a CHOICE that is itself a button, or wraps a native input. */
export const CHOICE_FOCUS =
  "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cobalt has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-cobalt";
/** A tile that can't be picked. */
export const CHOICE_OFF = "cursor-not-allowed bg-chalk text-ink-soft opacity-60 shadow-[inset_0_0_0_1.5px_var(--line)]";

/** A soft sun note ("Enter your address and choose a shipping speed before paying."). */
export const NOTE_SUN = "rounded-[14px] bg-sun-tint px-4 py-3 text-sm leading-relaxed text-ink";
/** A soft success note ("Saved.", "Cards added successfully!"). */
export const NOTE_OK = "rounded-[14px] bg-success-tint px-4 py-3 text-sm leading-relaxed text-success";
/** A soft error note. */
export const NOTE_ERROR = "rounded-[14px] bg-red-50 px-4 py-3 text-sm leading-relaxed text-destructive shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]";

/** A small text action ("Edit", "Remove"). */
export const TEXT_ACTION =
  "-my-2 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-cobalt underline-offset-4 hover:bg-cobalt-wash hover:underline";

/** A summary row and the total line, for receipts. */
export const SUM_ROW = "flex justify-between gap-3 text-[15px] text-ink-soft";
export const SUM_TOTAL =
  "mt-2 flex items-baseline justify-between gap-3 border-t-2 border-ink pt-4 font-heading text-[2rem] font-black leading-none text-ink";

/** The round radio mark inside a CHOICE that is a button, not a native radio. */
export function radioMark(on: boolean) {
  return on
    ? "grid size-5 shrink-0 place-items-center rounded-full bg-cobalt shadow-[inset_0_0_0_2px_var(--cobalt),inset_0_0_0_5px_var(--white)]"
    : "grid size-5 shrink-0 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1.5px_var(--input)]";
}
