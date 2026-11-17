"use client";

import { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

export type StackCard = { src: StaticImageData; alt: string };

/**
 * Where each of the three cards rests, in percent of the stack's width
 * (left, top) and its resting tilt. Cards are 44% of the stack's width and
 * share one shape (the Rayquaza card's 1074:1500), so the stack's height is
 * set by the lowest card: top 7.5% + 44% / 0.716 = 69%.
 */
const SPOTS = [
  { left: 0, top: 7.5, tilt: -6, z: 1 },
  { left: 28, top: 0, tilt: 2, z: 3 },
  { left: 56, top: 5, tilt: 5, z: 2 },
];
const CARD_W = 44;
const STACK_H = 7.5 + CARD_W / (1074 / 1500);

/**
 * Three real cards in a loose overlapping stack. Hovering (or focusing, or
 * tapping) any card lifts it to the very front, straightened and fully in
 * view; leaving puts the stack back as it was.
 */
export function CardStack({ cards, className }: { cards: StackCard[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ paddingBottom: `${STACK_H}%` }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") setActive(null);
      }}
    >
      {cards.slice(0, 3).map((card, i) => {
        const spot = SPOTS[i];
        const isActive = active === i;
        return (
          <figure
            key={card.alt}
            tabIndex={0}
            aria-label={card.alt}
            onPointerEnter={() => setActive(i)}
            onClick={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
            className={cn(
              "absolute m-0 cursor-pointer overflow-hidden outline-none",
              "[border-radius:5%/3.58%]",
              "shadow-[0_2px_4px_rgb(13_18_51/0.12),0_14px_32px_-8px_rgb(13_18_51/0.35)]",
              "transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              "focus-visible:ring-4 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-chalk",
              isActive && "shadow-[0_4px_8px_rgb(13_18_51/0.14),0_30px_60px_-12px_rgb(13_18_51/0.45)]"
            )}
            style={{
              left: `${spot.left}%`,
              top: `${(spot.top / STACK_H) * 100}%`,
              width: `${CARD_W}%`,
              zIndex: isActive ? 10 : spot.z,
              transform: isActive
                ? "translateY(-4%) rotate(0deg) scale(1.08)"
                : `rotate(${spot.tilt}deg)`,
            }}
          >
            <Image
              src={card.src}
              alt=""
              sizes="(min-width: 1280px) 270px, (min-width: 1024px) 22vw, 42vw"
              draggable={false}
              className="block h-auto w-full select-none"
            />
          </figure>
        );
      })}
    </div>
  );
}
