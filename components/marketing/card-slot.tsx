import Link from "next/link";
import Image from "next/image";
import doctor from "@/public/card-doctor.jpg";

export function CardSlot({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/start"
      aria-label="Place card here. The Doc will see you now. Start your order."
      className={`card-slot group relative block aspect-[5/7] rounded-[1.1rem] border-[3px] border-ink bg-rx text-white comic-shadow ${className}`}
    >
      <span aria-hidden className="halftone-light absolute inset-0 rounded-[inherit]" />
      <svg aria-hidden className="absolute inset-2.5 h-[calc(100%-1.25rem)] w-[calc(100%-1.25rem)] overflow-visible">
        <rect width="100%" height="100%" rx="10" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="2.5" strokeDasharray="11 9" className="slot-dash" />
      </svg>
      <span className="relative grid h-full grid-rows-[auto_1fr_auto] justify-items-center px-4 pt-5 pb-4 text-center sm:px-5 sm:pt-6">
        <span className="sticker block h-11 w-11 overflow-hidden bg-bone -rotate-6 transition-transform duration-500 ease-[var(--ease-out)] group-hover:rotate-6 sm:h-14 sm:w-14">
          <Image src={doctor} alt="" sizes="56px" className="h-full w-full object-cover object-[50%_18%]" />
        </span>
        <span className="self-center">
          <span className="block font-heading font-black uppercase leading-[0.92] tracking-[-0.01em] text-[clamp(1.35rem,6vw,2.1rem)] lg:text-[2.1rem]">
            Place card here.
          </span>
          <span className="mt-2.5 block font-heading text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/85 sm:text-[12px]">
            The Doc will see you now.
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/90 sm:text-xs">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden className="h-3.5 w-3.5">
            <rect x="3" y="3" width="14" height="14" rx="4.2" stroke="currentColor" strokeWidth="1.9" />
            <circle cx="10" cy="10" r="3.3" stroke="currentColor" strokeWidth="1.9" />
            <circle cx="14.3" cy="5.8" r="1.05" fill="currentColor" />
          </svg>
          the_card_doc
        </span>
      </span>
    </Link>
  );
}
