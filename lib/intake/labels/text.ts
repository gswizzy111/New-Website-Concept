import { FONT_METRICS } from "./fonts/metrics";
import type { FontRole } from "./types";

// Text measuring for the label layout, from the fonts' own advance widths
// (fonts/metrics.ts), so the server (PDF) and the browser (preview) break
// and fit every line the same way.

const ELLIPSIS = "…";

/** Invisible characters (format and control characters, variation selectors): never printed. */
const INVISIBLE = /^[\p{Cf}\p{Cc}\p{Variation_Selector}]$/u;
/** Emoji and pictographs (and their skin tones and flag letters): nothing a bag label needs, so left out rather than printed as "?". */
const PICTO = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]$/u;
const MARK = /\p{M}/gu;
/** Latin letters and marks with no decomposition to a plain letter the fonts have. */
const SPELLED: Record<string, string> = {
  "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "ĸ": "k", "Ŀ": "L", "ŀ": "l",
  "Ŋ": "N", "ŋ": "n", "Œ": "OE", "œ": "oe", "Ŧ": "T", "ŧ": "t", "ſ": "s", "ẞ": "SS", "Ƒ": "F", "ƒ": "f",
  "‐": "-", "‑": "-", "‒": "-", "―": "—", "−": "-", "‚": ",", "„": "\"", "′": "'", "″": "\"", "ʼ": "'",
};

/**
 * The text as the label fonts can draw it: one line, NFC; accents dropped
 * where only the plain letter exists (and a few letters spelled out: Ł → L,
 * Œ → OE); emoji and invisible characters left out; any other run of
 * characters the fonts lack (another script) as one "?", which the on-screen
 * preview shows too.
 */
export function printable(text: string | null | undefined, font: FontRole): string {
  const widths = FONT_METRICS[font].widths;
  const has = (s: string) => !!s && [...s].every((b) => widths[b.codePointAt(0)!] !== undefined);
  let out = "";
  let missing = false;
  for (const ch of (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim()) {
    if (INVISIBLE.test(ch)) continue;
    if (widths[ch.codePointAt(0)!] !== undefined) { out += ch; missing = false; continue; }
    if (PICTO.test(ch) || /^\p{M}$/u.test(ch)) continue;
    const plain = [ch.normalize("NFD").replace(MARK, ""), ch.normalize("NFKD").replace(MARK, ""), SPELLED[ch] ?? ""].find(has);
    if (plain) { out += plain; missing = false; continue; }
    if (!missing) out += "?";
    missing = true;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Width in points: advances plus `tracking` after every character but the last. */
export function textWidth(text: string, font: FontRole, size: number, tracking = 0): number {
  const m = FONT_METRICS[font];
  const q = m.widths[63] ?? 500;
  let units = 0;
  let n = 0;
  for (const ch of text) {
    units += m.widths[ch.codePointAt(0)!] ?? q;
    n++;
  }
  return (units / 1000) * size + Math.max(0, n - 1) * tracking;
}

/** Baseline of a line of `size` in a line box `lineHeight` (× size) high that starts at `top`, as CSS places it. */
export function baselineIn(top: number, font: FontRole, size: number, lineHeight: number): number {
  const m = FONT_METRICS[font];
  const content = ((m.ascent - m.descent) / 1000) * size;
  return top + (lineHeight * size - content) / 2 + (m.ascent / 1000) * size;
}

/** Cut the text to `maxW`, ending with "…". */
export function truncate(text: string, font: FontRole, size: number, maxW: number, tracking = 0): string {
  if (textWidth(text, font, size, tracking) <= maxW) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const t = chars.slice(0, mid).join("").trimEnd() + ELLIPSIS;
    if (textWidth(t, font, size, tracking) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ELLIPSIS : chars.slice(0, lo).join("").trimEnd() + ELLIPSIS;
}

/**
 * Fit one line in `maxW`: the full size if it fits, else smaller (never
 * below `minSize`), else cut with "…" at `minSize`.
 */
export function fitLine(text: string, font: FontRole, size: number, maxW: number, minSize: number, tracking = 0): { text: string; size: number } {
  const w = textWidth(text, font, size, tracking);
  if (w <= maxW) return { text, size };
  const scaled = Math.floor(size * (maxW / w) * 100) / 100;
  if (scaled >= minSize && textWidth(text, font, scaled, tracking * (scaled / size)) <= maxW) return { text, size: scaled };
  const small = Math.max(minSize, Math.min(size, scaled));
  return { text: truncate(text, font, small, maxW, tracking), size: small };
}

/** Word-wrap into at most `maxLines` lines; the last one is cut with "…" when the text doesn't fit. */
export function wrapLines(text: string, font: FontRole, size: number, maxW: number, maxLines: number, tracking = 0): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let i = 0;
  while (i < words.length) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (textWidth(next, font, size, tracking) <= maxW) {
      line = next;
      i++;
      continue;
    }
    if (!line) {
      // A word wider than the whole line: cut it and give it the line
      line = truncate(words[i], font, size, maxW, tracking);
      i++;
    }
    lines.push(line);
    line = "";
    if (lines.length === maxLines) break;
  }
  if (line) lines.push(line);
  if (i < words.length && lines.length === maxLines) {
    lines[maxLines - 1] = truncate([lines[maxLines - 1], ...words.slice(i)].join(" "), font, size, maxW, tracking);
  }
  return lines.length ? lines : [""];
}
