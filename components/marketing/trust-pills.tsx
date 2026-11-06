import { BadgeCheck, MessageCircle, ScanSearch, Users } from "lucide-react";
import { REASONS } from "@/lib/about";

export function TrustPills({ cardsRestored, className = "", align = "center" }: { cardsRestored: string; className?: string; align?: "center" | "start" }) {
  const pills = [
    { Icon: BadgeCheck, text: `${cardsRestored} Cards Restored` },
    { Icon: ScanSearch, text: "Free Photo Review" },
    { Icon: MessageCircle, text: "We reply within 1 business day." },
    { Icon: Users, text: REASONS.items[1].title },
  ];
  return (
    <div className={`relative ${className}`}>
      <ul
        aria-label="Why collectors trust The Card Doc"
        className={`no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${align === "center" ? "sm:justify-center" : ""}`}
      >
        {pills.map(({ Icon, text }) => (
          <li
            key={text}
            className="flex shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border-2 border-ink bg-bone px-3.5 py-1.5 text-[12px] font-semibold text-ink md:text-[13px]"
          >
            <Icon className="h-3.5 w-3.5 text-rx" strokeWidth={2.25} />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
