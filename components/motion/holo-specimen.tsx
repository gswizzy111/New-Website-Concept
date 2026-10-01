"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * A specimen under glass.
 *
 * - Mouse: the card tilts toward the pointer on critically damped springs
 *   (Apple: damping 1.0, response ~0.45s) and a holo foil + glare follow it.
 * - Every device: the foil band rides the scroll position and brightens with
 *   scroll speed, so phones see the card shimmer as the page moves. The card
 *   drifts up and tips back slightly as it leaves the viewport.
 * - A contact shadow slides opposite the tilt to sell the depth.
 * Reduced motion: a still card, no foil.
 */
export function HoloSpecimen({
  children,
  className,
  radius = "rounded-lg",
  drift = 60,
}: {
  children: React.ReactNode;
  className?: string;
  radius?: string;
  drift?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();

  // Pointer position, 0..1 across the card (0.5 = centre / at rest).
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { bounce: 0, duration: 0.45 };
  const sx = useSpring(px, spring);
  const sy = useSpring(py, spring);
  const hover = useSpring(0, spring);

  const rotateY = useTransform(sx, [0, 1], [-10, 10]);
  const pointerTiltX = useTransform(sy, [0, 1], [8, -8]);

  // Scroll: 0.5 is "centred in the viewport" for anything near the top.
  const { scrollYProgress, scrollY } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scrollTiltX = useTransform(scrollYProgress, [0.5, 1], [0, 9], { clamp: true });
  const rotateX = useTransform(() => pointerTiltX.get() + scrollTiltX.get());
  const y = useTransform(scrollYProgress, [0.5, 1], [0, -drift], { clamp: true });

  // Foil: follows the pointer while hovered, the scroll position otherwise.
  const speed = useSpring(useTransform(useVelocity(scrollY), (v) => Math.min(Math.abs(v) / 2400, 1)), {
    bounce: 0,
    duration: 0.6,
  });
  const foilX = useTransform(() => {
    const h = hover.get();
    return (1 - h) * (20 + scrollYProgress.get() * 120) + h * sx.get() * 100;
  });
  const foilY = useTransform(() => {
    const h = hover.get();
    return (1 - h) * (scrollYProgress.get() * 100) + h * sy.get() * 100;
  });
  const foilPosition = useMotionTemplate`${foilX}% ${foilY}%`;
  // Kept light: the photo underneath is the evidence and must stay legible.
  const foilOpacity = useTransform(() => 0.08 + hover.get() * 0.16 + speed.get() * 0.24);

  const glareX = useTransform(sx, [0, 1], [0, 100]);
  const glareY = useTransform(sy, [0, 1], [0, 100]);
  const glare = useMotionTemplate`radial-gradient(90% 70% at ${glareX}% ${glareY}%, oklch(1 0 0 / 0.75), oklch(1 0 0 / 0.15) 40%, transparent 70%)`;
  const glareOpacity = useTransform(hover, [0, 1], [0, 0.55]);

  const shadowX = useTransform(sx, [0, 1], [22, -22]);
  const shadowOpacity = useTransform(() => 0.55 - scrollTiltX.get() / 30);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
    hover.set(1);
  }
  function onLeave() {
    px.set(0.5);
    py.set(0.5);
    hover.set(0);
  }

  if (reduce) return <div ref={ref} className={cn("relative", className)}>{children}</div>;

  return (
    <motion.div ref={ref} style={{ y }} className={cn("relative [perspective:1200px]", className)}>
      {/* Contact shadow on the table */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-[10%] -bottom-5 h-14 rounded-[50%] bg-ink/40 blur-2xl"
        style={{ x: shadowX, opacity: shadowOpacity }}
      />
      <motion.div
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className={cn("relative will-change-transform", radius)}
      >
        {children}
        {/* Holo foil */}
        <motion.div
          aria-hidden
          className={cn("holo-bands pointer-events-none absolute inset-0 mix-blend-color-dodge", radius)}
          style={{ backgroundPosition: foilPosition, opacity: foilOpacity }}
        />
        {/* Glare */}
        <motion.div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 mix-blend-soft-light", radius)}
          style={{ backgroundImage: glare, opacity: glareOpacity }}
        />
      </motion.div>
    </motion.div>
  );
}
