"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { Print } from "@/components/brand";
import { cn } from "@/lib/utils";
import Image, { type StaticImageData } from "next/image";

export type ProcessStep = { title: string; note: string };
export type StepPhoto = { src: StaticImageData; alt: string; aspect: string; position?: string };

function Step({
  step,
  index,
  active,
  onActive,
}: {
  step: ProcessStep;
  index: number;
  active: boolean;
  onActive: (i: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Active while the step crosses the middle band of the screen.
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);
  return (
    <li
      ref={ref}
      className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:gap-y-0 border-t border-line-dark py-7 sm:grid-cols-[6.5rem_minmax(0,1fr)] md:py-9 lg:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <span
        aria-hidden
        className={cn(
          "font-display text-[56px] font-black leading-[0.8] tracking-[-0.02em] transition-colors duration-200 sm:text-[88px] md:text-[104px]",
          active ? "text-sun" : "text-sun lg:text-white/25"
        )}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span>
        <span className="sr-only">Step {index + 1}: </span>
        <span className="block font-display text-[clamp(20px,6.2vw,26px)] font-extrabold leading-[1.05] text-white break-words hyphens-none sm:text-[26px] md:text-[32px]">
          {step.title}
        </span>
        <span className="mt-3 block text-[15px] leading-relaxed text-on-dark-muted">{step.note}</span>
      </span>
    </li>
  );
}

/**
 * The six steps beside a sticky print (lg and up) whose photo follows the
 * step in the middle of the screen, with a 200ms crossfade (instant under
 * reduced motion). Phones get one photo after step 03.
 */
export function ProcessSteps({
  steps,
  photos,
  phonePhoto,
}: {
  steps: ProcessStep[];
  /** One photo index per step (into `photos`). */
  photos: { list: StepPhoto[]; forStep: number[] };
  phonePhoto: StepPhoto;
}) {
  const [active, setActive] = useState(0);
  const current = photos.forStep[active] ?? 0;
  return (
    <div className="grid gap-x-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
      <ol className="border-b border-line-dark">
        {steps.map((step, i) => (
          <StepWithPhoto key={step.title} show={i === 2} photo={phonePhoto}>
            <Step step={step} index={i} active={i === active} onActive={setActive} />
          </StepWithPhoto>
        ))}
      </ol>
      <div className="hidden lg:block">
        <div className="sticky top-[calc(var(--header-h)+2rem)] pt-7">
          <div className="print print-lg print-dark" style={{ ["--tilt" as string]: "2deg" }}>
            <div className="print-media" style={{ aspectRatio: photos.list[0].aspect }}>
              {photos.list.map((p, i) => (
                <Image
                  key={p.src.src}
                  src={p.src}
                  alt={i === current ? p.alt : ""}
                  aria-hidden={i !== current}
                  fill
                  sizes="(min-width: 1280px) 432px, 384px"
                  className={cn(
                    "object-cover transition-opacity duration-200 ease-out motion-reduce:transition-none",
                    i === current ? "opacity-100" : "opacity-0"
                  )}
                  style={p.position ? { objectPosition: p.position } : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepWithPhoto({ show, photo, children }: { show: boolean; photo: StepPhoto; children: React.ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <>
      {children}
      <li aria-hidden className="pb-8 lg:hidden">
        <Print
          src={photo.src}
          alt=""
          aspect="4/3"
          position={photo.position}
          surface="dark"
          tilt={-2}
          sizes="(min-width: 640px) 28rem, 88vw"
          className="mx-auto w-full max-w-[28rem]"
        />
      </li>
    </>
  );
}
