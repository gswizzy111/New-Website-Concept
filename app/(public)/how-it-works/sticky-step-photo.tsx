"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The sticky photo column beside the steps (desktop). Each layer belongs to a
 * run of steps; the step crossing the middle of the viewport picks the layer,
 * and layers crossfade in 200ms (instant under reduced motion). Steps are the
 * list items marked data-step="n" inside the element with id `listId`.
 */
export function StickyStepPhoto({
  listId,
  layers,
}: {
  listId: string;
  layers: { steps: string[]; node: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const list = document.getElementById(listId);
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>("[data-step]"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const step = (entry.target as HTMLElement).dataset.step ?? "";
          const index = layers.findIndex((l) => l.steps.includes(step));
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [listId, layers]);

  return (
    <div className="grid">
      {layers.map((layer, i) => (
        <div
          key={i}
          aria-hidden={i !== active}
          className={cn(
            "col-start-1 row-start-1 transition-opacity duration-200 ease-out motion-reduce:transition-none",
            i === active ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          {layer.node}
        </div>
      ))}
    </div>
  );
}
