import { PREVIEW_MODE } from "@/lib/preview";

export function PreviewBanner() {
  if (!PREVIEW_MODE) return null;
  return (
    <div className="w-full bg-ink text-on-dark-muted">
      <p className="wrap py-1.5 text-center text-xs leading-snug md:text-[13px]">
        <span aria-hidden className="mr-2 inline-block size-2 -translate-y-px rounded-full bg-sun align-middle" />
        <span className="font-bold text-white">Preview site.</span>{" "}
        Checkout, payments, shipping and accounts are not functional yet.
      </p>
    </div>
  );
}
