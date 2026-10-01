"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

/**
 * Hero specimen as a holo card: tilts toward the pointer on critically damped
 * springs (Apple: damping 1.0, response ~0.4s), with a foil sheen that tracks
 * the pointer. As the hero scrolls away it drifts up and settles back.
 * Fine pointers only; reduced motion keeps it still.
 */
export function HoloSpecimen({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Pointer position, 0..1 across the card (0.5 = centre / at rest).
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { bounce: 0, duration: 0.4 };
  const sx = useSpring(px, spring);
  const sy = useSpring(py, spring);

  const rotateY = useTransform(sx, [0, 1], [-9, 9]);
  const rotateX = useTransform(sy, [0, 1], [7, -7]);
  const glow = useSpring(0, spring);

  const sheenX = useTransform(sx, [0, 1], [0, 100]);
  const sheenY = useTransform(sy, [0, 1], [0, 100]);
  const sheen = useMotionTemplate`radial-gradient(120% 90% at ${sheenX}% ${sheenY}%, oklch(1 0 0 / 0.55) 0%, oklch(0.92 0.09 180 / 0.35) 22%, oklch(0.9 0.12 300 / 0.28) 38%, oklch(0.93 0.13 90 / 0.25) 52%, transparent 70%)`;

  // Scroll: drift up and ease back as the hero leaves the viewport.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const settle = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const scrollTransform = useMotionTemplate`translateY(${drift}px) scale(${settle})`;
  const tiltTransform = useMotionTemplate`rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
    glow.set(1);
  }
  function onLeave() {
    px.set(0.5);
    py.set(0.5);
    glow.set(0);
  }

  if (reduce) return <div ref={ref}>{children}</div>;

  return (
    <motion.div ref={ref} style={{ transform: scrollTransform }} className="[perspective:1100px]">
      <motion.div
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={{ transform: tiltTransform, transformStyle: "preserve-3d" }}
        className="relative will-change-transform"
      >
        {children}
        {/* Holo foil sheen */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg mix-blend-soft-light"
          style={{ backgroundImage: sheen, opacity: glow }}
        />
      </motion.div>
    </motion.div>
  );
}
