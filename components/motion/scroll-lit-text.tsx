"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useForwardOnly } from "@/components/motion/use-scroll-once";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

// Opacity a word sits at before the reader reaches it.
const UNLIT = 0.18;
// Share of the scroll range each word takes to light; the rest staggers them.
const WORD_SPAN = 0.18;

type Segment = { text: string; lit: number };

function Word({ word, progress, range, lit }: { word: string; progress: MotionValue<number>; range: [number, number]; lit: number }) {
  const opacity = useTransform(progress, range, [UNLIT, lit]);
  return <motion.span style={{ opacity }}>{word}</motion.span>;
}

/**
 * Text that lights up word by word as it scrolls up the viewport, so the eye
 * reads it at the pace of the scroll. Each segment ends at its own opacity
 * (`lit`), which is how a phrase is emphasised. Forward only: scrolling back
 * up leaves it lit. Reduced motion: the final state, still.
 */
export function ScrollLitText({ segments }: { segments: Segment[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.88", "end 0.55"] });
  const progress = useForwardOnly(scrollYProgress);

  if (reduce) {
    return (
      <span ref={ref}>
        {segments.map((s, i) => <span key={i} style={{ opacity: s.lit }}>{s.text}</span>)}
      </span>
    );
  }

  const words = segments.flatMap((s) => s.text.split(/(\s+)/).filter(Boolean).map((w) => ({ w, lit: s.lit })));
  const count = words.filter((t) => t.w.trim()).length;
  let index = 0;
  return (
    <span ref={ref}>
      {words.map((t, i) => {
        if (!t.w.trim()) return t.w;
        const start = (index++ / count) * (1 - WORD_SPAN);
        return <Word key={i} word={t.w} progress={progress} range={[start, start + WORD_SPAN]} lit={t.lit} />;
      })}
    </span>
  );
}
