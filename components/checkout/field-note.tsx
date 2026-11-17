/** The red note under a field that needs fixing (restoration contact step, prep form). */
export function FieldNote({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-destructive" role="alert">
      <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full bg-destructive text-[11px] font-black leading-none text-white">!</span>
      {text}
    </p>
  );
}
