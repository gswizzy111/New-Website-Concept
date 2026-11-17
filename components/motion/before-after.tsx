"use client";

import { useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { ChevronsLeftRight } from "lucide-react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

type Props = {
  before: StaticImageData;
  after: StaticImageData;
  beforeAlt: string;
  afterAlt: string;
  sizes: string;
  priority?: boolean;
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));
// Where the divider rests (percent from the left): through the face, so
// both states of it show, restored side the larger. Keep in step with
// --split's initial value and ba-sweep in globals.css.
const REST = 42;

/**
 * The damaged and the restored photo of the same card, aligned and stacked,
 * read the site's way: Before on the left, After on the right. The damaged
 * layer covers the restored one from the left up to a divider (`--split`).
 * The two labels sit above both layers, pinned to the frame's top corners;
 * each fades out only when the divider nearly reaches its side, so neither
 * is ever cut mid-word.
 * Hovering does nothing: the divider only moves while it is dragged. A mouse
 * press or a tap jumps it to that spot and dragging follows the pointer 1:1;
 * a finger drags it sideways (vertical swipes still scroll); arrow keys step
 * it. On load it sweeps from mostly damaged to mostly restored in CSS, so it runs
 * before hydration. It stays wherever it was left; nothing winds it back.
 */
export function BeforeAfter({ before, after, beforeAlt, afterAlt, sizes, priority }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const live = useRef(false);
  const [isLive, setIsLive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [valueNow, setValueNow] = useState(REST);
  const drag = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);

  const target = useMotionValue(REST);
  const smooth = useSpring(target, { bounce: 0, duration: 0.3 });
  const split = useMotionTemplate`${smooth}%`;
  // Before needs room on the left, After on the right.
  const beforeOpacity = useTransform(smooth, [8, 14], [0, 1]);
  const afterOpacity = useTransform(smooth, [86, 92], [1, 0]);

  function pct(clientX: number) {
    const r = ref.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100);
  }

  // `instant`: while dragging, the divider sits exactly under the pointer.
  function moveTo(v: number, instant = false) {
    if (!live.current) {
      // Take over from the CSS intro exactly where it is, so nothing jumps.
      const now = parseFloat(getComputedStyle(ref.current!).getPropertyValue("--split"));
      if (!Number.isNaN(now)) {
        target.jump(now);
        smooth.jump(now);
      }
      live.current = true;
      setIsLive(true);
    }
    target.set(v);
    if (instant || reduce) smooth.jump(v);
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current!.dragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
    // A mouse press grabs the divider at once; touch waits to see which way
    // the finger goes, so vertical swipes still scroll the page.
    if (e.pointerType === "mouse") {
      startDrag(e);
      moveTo(pct(e.clientX));
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return; // hovering never moves it
    if (!d.dragging) {
      const dx = Math.abs(e.clientX - d.x);
      if (dx < 6 || dx < Math.abs(e.clientY - d.y)) return;
      startDrag(e);
    }
    moveTo(pct(e.clientX), true);
  }

  function endDrag() {
    drag.current = null;
    setIsDragging(false);
    setValueNow(Math.round(target.get()));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.id === e.pointerId && !d.dragging) moveTo(pct(e.clientX)); // a tap jumps there
    endDrag();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 20 : 5;
    const from = live.current ? target.get() : REST;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown" ? from - step
      : e.key === "ArrowRight" || e.key === "ArrowUp" ? from + step
      : e.key === "Home" ? 0
      : e.key === "End" ? 100
      : null;
    if (next === null) return;
    e.preventDefault();
    moveTo(clamp(next));
    setValueNow(Math.round(clamp(next)));
  }

  return (
    <motion.div
      ref={ref}
      data-live={isLive ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      style={{ "--split": split } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      className="ba-intro group/ba relative touch-pan-y select-none overflow-hidden cursor-grab data-[dragging]:cursor-grabbing"
    >
      {/* Restored: the base layer, seen right of the divider */}
      <Image src={after} alt={afterAlt} sizes={sizes} priority={priority} draggable={false} className="block w-full h-auto" />

      {/* Damaged: covers the left of the frame up to the divider */}
      <div className="ba-before absolute inset-0">
        <Image src={before} alt={beforeAlt} sizes={sizes} priority={priority} draggable={false} className="block w-full h-full object-cover" />
      </div>

      {/* Labels: one overlay above both layers, never clipped by them. Before
          the pointer takes over, the CSS sweep keeps both in view. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[3]">
        <motion.span className="ba-label ba-label-before left-2.5" style={isLive ? { opacity: beforeOpacity } : undefined}>
          Before
        </motion.span>
        <motion.span className="ba-label ba-label-after right-2.5" style={isLive ? { opacity: afterOpacity } : undefined}>
          After
        </motion.span>
      </div>

      {/* Divider and handle */}
      <div aria-hidden className="ba-divider pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Before and after comparison"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valueNow}
        aria-valuetext={`${100 - valueNow}% restored`}
        onKeyDown={onKeyDown}
        className="ba-handle absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
      >
        <ChevronsLeftRight aria-hidden className="size-6" strokeWidth={2.25} />
      </div>
    </motion.div>
  );
}
