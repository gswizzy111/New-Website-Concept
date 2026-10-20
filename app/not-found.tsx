import Link from "next/link";
import { NotFoundPanel } from "@/components/marketing/not-found-panel";

export const metadata = { title: "404 | The Card Doc" };

// Unmatched URLs render here, outside the marketing layout, so the page
// carries its own brand mark.
export default function NotFound() {
  return (
    <div className="page-glow flex flex-1 flex-col min-h-screen">
      <div className="max-w-7xl w-full mx-auto px-4 md:px-10 py-5">
        <Link href="/" className="inline-flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/card-doctor.jpg" alt="" className="w-9 h-9 rounded-md object-cover ring-1 ring-rule" />
          <span className="font-heading text-lg tracking-[-0.01em] text-ink">The Card Doc</span>
        </Link>
      </div>
      <div className="flex flex-1 items-center">
        <NotFoundPanel />
      </div>
    </div>
  );
}
