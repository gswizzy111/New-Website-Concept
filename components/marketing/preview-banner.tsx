import { PREVIEW_MODE } from "@/lib/preview";

export function PreviewBanner() {
  if (!PREVIEW_MODE) return null;
  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 text-amber-950">
      <p className="max-w-7xl mx-auto px-4 md:px-10 py-2 text-xs md:text-sm text-center">
        <span className="font-semibold">Preview site.</span>{" "}
        Checkout, payments, shipping and accounts are not functional yet.
      </p>
    </div>
  );
}
