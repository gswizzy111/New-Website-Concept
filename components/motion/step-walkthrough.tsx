"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

type Step = { n: string; title: string; body: string };

/**
 * Sticky scroll walkthrough: the current step's number and title stay pinned
 * on the left while the steps scroll past on the right; a progress rule fills
 * with scroll and the step in the middle of the viewport lights up.
 */
export function StepWalkthrough({ title, steps }: { title: string; steps: Step[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 60%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { bounce: 0, duration: 0.3 });

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    itemRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const current = steps[active];

  return (
    <div ref={ref} className="grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:gap-16">
      <div className="md:sticky md:top-32 md:self-start">
        <h2 className="font-heading text-3xl md:text-5xl font-extrabold tracking-tight text-ink mb-6">{title}</h2>
        <div className="hidden md:block" aria-hidden>
          <div className="flex items-baseline gap-4">
            <span key={current.n} className="font-heading text-[7rem] leading-none font-extrabold tracking-[-0.05em] text-rx tabular-nums animate-[rx-in_500ms_var(--ease-out)_both]">
              {current.n}
            </span>
            <span className="font-mono text-sm text-muted-foreground">/ {steps.length}</span>
          </div>
          <p key={current.title} className="mt-3 font-heading text-2xl font-bold text-ink animate-[rx-in_500ms_var(--ease-out)_both]">
            {current.title}
          </p>
        </div>
      </div>

      <div className="relative">
        {/* Progress rule */}
        <div className="absolute left-[13px] top-2 bottom-2 w-px bg-rule" aria-hidden />
        <motion.div
          className="absolute left-[13px] top-2 bottom-2 w-px origin-top bg-rx"
          style={{ scaleY: reduce ? 1 : progress }}
          aria-hidden
        />
        <ol className="flex flex-col gap-10 md:gap-0">
          {steps.map((step, i) => (
            <li
              key={step.n}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-index={i}
              className="relative flex items-start gap-5 md:min-h-[38vh] md:py-6"
            >
              <span
                className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs transition-colors duration-300 ${
                  i <= active ? "bg-rx text-primary-foreground" : "bg-white text-muted-foreground ring-1 ring-rule"
                }`}
              >
                {step.n}
              </span>
              <div className={`transition-opacity duration-300 ${i === active ? "opacity-100" : "md:opacity-45"}`}>
                <p className="font-heading text-xl md:text-2xl font-bold text-ink">{step.title}</p>
                <p className="mt-1.5 text-[15px] md:text-base text-muted-foreground leading-relaxed max-w-[48ch]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
