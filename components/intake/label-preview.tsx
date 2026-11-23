"use client";

import { useMemo } from "react";
import { Big_Shoulders, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import { qrMatrix, qrPath } from "@/lib/intake/labels/qr";
import type { FontRole, LabelColor, LabelElement, LabelPage } from "@/lib/intake/labels/types";

// The label fonts on screen (the PDF embeds the same faces). Widths come
// from the layout, so each line is stretched to exactly its printed length.
const display = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-label-display", display: "swap" });
const body = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-label-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["600"], variable: "--font-label-mono", display: "swap" });

/** The label fonts' CSS variables, for the element that holds the previews. */
export const LABEL_FONT_VARS = `${display.variable} ${body.variable} ${mono.variable}`;

/** Navy on screen (Design A); the thermal printer prints black only. */
export const LABEL_NAVY = "#13224a";

const FONTS: Record<FontRole, { family: string; weight: number; variation?: string }> = {
  display800: { family: "var(--font-label-display), 'Big Shoulders Display', 'Arial Narrow', sans-serif", weight: 800, variation: "'opsz' 72" },
  display900: { family: "var(--font-label-display), 'Big Shoulders Display', 'Arial Narrow', sans-serif", weight: 900, variation: "'opsz' 72" },
  body400: { family: "var(--font-label-body), 'Schibsted Grotesk', Arial, sans-serif", weight: 400 },
  body700: { family: "var(--font-label-body), 'Schibsted Grotesk', Arial, sans-serif", weight: 700 },
  body800: { family: "var(--font-label-body), 'Schibsted Grotesk', Arial, sans-serif", weight: 800 },
  mono600: { family: "var(--font-label-mono), 'IBM Plex Mono', 'Courier New', monospace", weight: 600 },
};

function fill(c: LabelColor, printed: boolean) {
  return c === "paper" ? "#ffffff" : c === "accent" && !printed ? LABEL_NAVY : "#000000";
}

function QrCode({ data, x, y, size, alt }: { data: string; x: number; y: number; size: number; alt: string }) {
  const { n, d } = useMemo(() => {
    const m = qrMatrix(data);
    return { n: m.size, d: qrPath(m) };
  }, [data]);
  return (
    <g role="img" aria-label={alt} transform={`translate(${x} ${y}) scale(${size / n})`}>
      <path d={d} fill="#000000" shapeRendering="crispEdges" />
    </g>
  );
}

function Element({ e, printed }: { e: LabelElement; printed: boolean }) {
  switch (e.kind) {
    case "rect": {
      const sw = e.stroke ? e.strokeWidth ?? 0 : 0;
      return (
        <rect
          x={e.x + sw / 2}
          y={e.y + sw / 2}
          width={Math.max(0, e.w - sw)}
          height={Math.max(0, e.h - sw)}
          rx={Math.max(0, (e.radius ?? 0) - sw / 2)}
          fill={e.fill ? fill(e.fill, printed) : "none"}
          stroke={e.stroke ? fill(e.stroke, printed) : undefined}
          strokeWidth={sw || undefined}
        />
      );
    }
    case "line":
      return (
        <line
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke={fill(e.color, printed)}
          strokeWidth={e.width}
          strokeDasharray={e.dash?.join(" ")}
        />
      );
    case "qr":
      return <QrCode data={e.data} x={e.x} y={e.y} size={e.size} alt={e.alt} />;
    case "text": {
      const f = FONTS[e.font];
      return (
        <text
          x={e.x}
          y={e.y}
          fontSize={e.size}
          fill={fill(e.color, printed)}
          letterSpacing={e.tracking || undefined}
          // Untracked lines are pinned to their measured (printed) width
          textLength={e.tracking ? undefined : e.width}
          lengthAdjust={e.tracking ? undefined : "spacingAndGlyphs"}
          style={{ fontFamily: f.family, fontWeight: f.weight, fontVariationSettings: f.variation }}
        >
          {e.text}
        </text>
      );
    }
  }
}

/**
 * One label (or tag) page drawn from the same layout the PDF prints, at its
 * true proportions: up to its real size on screen, smaller on narrow screens.
 * `printed` shows it as the thermal printer will (navy becomes black).
 */
export function LabelPreview({ page, printed = false, label, className = "" }: { page: LabelPage; printed?: boolean; label: string; className?: string }) {
  return (
    <div className={`${LABEL_FONT_VARS} ${className}`} style={{ width: "100%", maxWidth: (page.width * 96) / 72 }}>
      <svg
        viewBox={`0 0 ${page.width} ${page.height}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full rounded-lg bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.12),0_6px_18px_-8px_rgba(15,23,42,0.25)]"
      >
        <rect x={0} y={0} width={page.width} height={page.height} fill="#ffffff" />
        {page.elements.map((e, i) => (
          <Element key={i} e={e} printed={printed} />
        ))}
      </svg>
    </div>
  );
}
