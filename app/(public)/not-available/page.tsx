import Link from "next/link";
import { Construction } from "lucide-react";
import { PREVIEW_MESSAGE } from "@/lib/preview";

export const metadata = { title: "Not available yet | The Card Doc" };

export default function NotAvailablePage() {
  return (
    <div className="bg-paper">
      <div className="max-w-xl mx-auto px-4 md:px-10 py-24 md:py-32">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-rx-soft text-rx mb-6">
          <Construction className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <h1 className="font-heading text-4xl md:text-5xl font-extrabold tracking-[-0.03em] text-ink mb-4">
          Not functional yet
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-8">{PREVIEW_MESSAGE}</p>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-md bg-rx px-6 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
