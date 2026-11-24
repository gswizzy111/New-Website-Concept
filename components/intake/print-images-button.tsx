"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import type { LabelPage } from "@/lib/intake/labels/types";
import {
  canShareFiles,
  detectShareDevice,
  downloadFile,
  isLabelPage,
  labelPagesFromJson,
  labelPngFiles,
  openFile,
  type NamedLabelPage,
} from "./label-image";

/** The staff guide: how to print on the Katasymbol from a phone. */
export const PRINTING_GUIDE_PATH = "/admin/receiving/printing";

const noSubscribe = () => () => {};
function useShareCapable(): boolean {
  return useSyncExternalStore(noSubscribe, detectShareDevice, () => false);
}

type Loaded = { key: string; files: File[] | null; error: string | null };

/**
 * The pictures of some label pages, drawn ahead of the tap (Safari only opens
 * the share sheet straight from a tap, so nothing slow may run in between).
 * `pages` are drawn as given; otherwise `url` (a label route's ?format=json)
 * is fetched first.
 */
export function useLabelImages({
  pages,
  url,
  baseName = "label",
  dotsPerMm,
  enabled = true,
}: {
  pages?: (LabelPage | NamedLabelPage)[];
  url?: string;
  baseName?: string;
  dotsPerMm?: number;
  enabled?: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  const pagesJson = useMemo(() => (pages ? JSON.stringify(pages) : null), [pages]);
  const key = `${pagesJson ?? url ?? ""}|${baseName}|${dotsPerMm ?? ""}|${retry}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      let named: NamedLabelPage[] = [];
      if (pagesJson) {
        const list = JSON.parse(pagesJson) as (LabelPage | NamedLabelPage)[];
        named = list.map((p, i) => (isLabelPage(p) ? { name: list.length > 1 ? `${baseName}-${i + 1}` : baseName, page: p } : p));
      } else if (url) {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        named = labelPagesFromJson(body, baseName);
      }
      if (!named.length) throw new Error("There are no labels to print.");
      const files = await labelPngFiles(named, { dotsPerMm });
      if (!cancelled) setLoaded({ key, files, error: null });
    })().catch((err: Error) => {
      if (!cancelled) setLoaded({ key, files: null, error: err?.message || "The label pictures couldn't be made." });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, pagesJson, url, baseName, dotsPerMm]);

  const current = loaded?.key === key ? loaded : null;
  return {
    files: current?.files ?? null,
    error: current?.error ?? null,
    loading: enabled && !current,
    retry: () => setRetry((r) => r + 1),
  };
}

/** Where a batch stands: not started, or sending one picture at a time (the next one's index). */
type Flow = { key: string; next: number | null; oneByOne: boolean };

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/**
 * Prints label pages on the Katasymbol (or any app that takes pictures): each
 * page becomes a black-and-white PNG at the printer's resolution (50 x 80 mm
 * = 400 x 640), drawn before the tap.
 * - Phone: every picture goes to the share sheet at once ("Save 20 Images",
 *   or Katasymbol when it is listed). A phone that can't take several at once,
 *   or "One at a time", sends them one per tap with "Next label (2 of 20)".
 *   A phone that can't share files opens the picture to save it.
 * - Computer: the pictures download.
 * `onPrinted` runs once every picture has been handed over.
 */
export function PrintImagesButton({
  pages,
  url,
  baseName = "label",
  dotsPerMm,
  children,
  variant = "primary",
  disabled = false,
  onPrinted,
  showGuideLink = true,
}: {
  /** The pages to print (with names for the files), or… */
  pages?: (LabelPage | NamedLabelPage)[];
  /** …a label route's JSON address (?format=json) that sends them. */
  url?: string;
  /** File name when a page has no code of its own: "slots" → slots-1.png, slots-2.png. */
  baseName?: string;
  /** 8 (203 dpi, default) or 11.8 (300 dpi). */
  dotsPerMm?: number;
  children: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  onPrinted?: () => void | Promise<void>;
  showGuideLink?: boolean;
}) {
  const share = useShareCapable();
  const { files, error, loading, retry } = useLabelImages({ pages, url, baseName, dotsPerMm, enabled: !disabled });
  const filesKey = files ? files.map((f) => `${f.name}:${f.size}`).join(",") : "";
  const [flowState, setFlow] = useState<Flow | null>(null);
  const flow: Flow = flowState?.key === filesKey ? flowState : { key: filesKey, next: null, oneByOne: false };
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ key: string; count: number; how: "shared" | "downloaded" | "opened" } | null>(null);
  const done = sent?.key === filesKey ? sent : null;
  const n = files?.length ?? 0;

  async function finish(how: "shared" | "downloaded" | "opened") {
    setFlow({ key: filesKey, next: null, oneByOne: false });
    setSent({ key: filesKey, count: n, how });
    try {
      await onPrinted?.();
    } catch {
      // The labels went out; only the caller's follow-up failed
    }
  }

  /** Sends picture `i` alone, then waits for the next tap. */
  async function shareOne(i: number) {
    if (!files) return;
    setBusy(true);
    setProblem(null);
    try {
      await navigator.share({ files: [files[i]] });
      if (i + 1 >= files.length) await finish("shared");
      else setFlow({ key: filesKey, next: i + 1, oneByOne: true });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "NotAllowedError") setProblem("The phone needs another tap: tap the button again.");
      else if (name !== "AbortError") setProblem("The share sheet didn't open. Open the picture instead, then save it.");
    } finally {
      setBusy(false);
    }
  }

  async function shareAll() {
    if (!files) return;
    setBusy(true);
    setProblem(null);
    try {
      await navigator.share({ files });
      await finish("shared");
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "NotAllowedError") setProblem("The phone needs another tap: tap the button again.");
      else if (name !== "AbortError") {
        // Some phones list fewer apps (or none) for several files: one at a time instead
        setFlow({ key: filesKey, next: 0, oneByOne: true });
        setProblem(`Your phone couldn't take all ${n} at once. Send them one at a time: tap Next label after each.`);
      }
    } finally {
      setBusy(false);
    }
  }

  function downloadAll() {
    if (!files) return;
    // Spaced out: browsers drop downloads that start in the same instant
    files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 250));
    void finish("downloaded");
  }

  function openNext(i: number) {
    if (!files) return;
    if (!openFile(files[i])) {
      setProblem("The picture didn't open. Allow pop-ups for this site, or save the pictures instead.");
      return;
    }
    setProblem(null);
    if (i + 1 >= files.length) void finish("opened");
    else setFlow({ key: filesKey, next: i + 1, oneByOne: true });
  }

  function print(oneByOne = flow.oneByOne) {
    if (!files || busy) return;
    const i = flow.next ?? 0;
    if (!share) return downloadAll();
    if (!canShareFiles([files[i]])) return openNext(i);
    if (!oneByOne && flow.next === null && files.length > 1 && canShareFiles(files)) return void shareAll();
    if (flow.next === null && files.length > 1 && !oneByOne) {
      // Several pictures, but the share sheet takes one at a time on this phone
      setFlow({ key: filesKey, next: 0, oneByOne: true });
    }
    void shareOne(i);
  }

  const cls =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-border bg-white text-foreground hover:bg-muted";
  const inProgress = flow.next !== null && flow.next > 0;
  const label = loading
    ? "Preparing…"
    : busy
      ? "Sending…"
      : flow.next !== null
        ? // One at a time (also right after "couldn't take all at once", which says to tap Next label)
          `Next label (${flow.next + 1} of ${n})`
        : children;

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => print()}
        disabled={disabled || busy || loading || !files}
        className={`${cls} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-opacity disabled:opacity-50`}
      >
        <Printer className="size-4" strokeWidth={1.75} aria-hidden />
        {label}
      </button>

      {share && n > 1 && flow.next === null && !busy && (
        <button
          type="button"
          onClick={() => print(true)}
          disabled={disabled || loading || !files}
          className="inline-flex min-h-11 items-center self-start px-1 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
        >
          Send one at a time
        </button>
      )}

      <span aria-live="polite" className="flex flex-col gap-1">
        {inProgress && (
          <span className="text-xs text-muted-foreground">
            {flow.next} of {n} sent. Print it in Katasymbol, then tap Next label.{" "}
            <button
              type="button"
              onClick={() => {
                setFlow({ key: filesKey, next: null, oneByOne: false });
                setProblem(null);
              }}
              className="inline-flex min-h-11 items-center px-1 font-semibold text-primary hover:underline"
            >
              Start over
            </button>
          </span>
        )}
        {done && !inProgress && (
          <span role="status" className="text-xs font-medium text-green-700">
            {done.how === "downloaded"
              ? `${done.count} ${plural(done.count, "picture", "pictures")} saved to Downloads.`
              : done.how === "opened"
                ? `${done.count} ${plural(done.count, "picture", "pictures")} opened: press and hold, Save to Photos.`
                : `${done.count} ${plural(done.count, "label", "labels")} sent. In Katasymbol: Image, pick ${plural(done.count, "it", "each")}, Print.`}
            {showGuideLink && (
              <>
                {" "}
                <AdminLink href={PRINTING_GUIDE_PATH} className="font-semibold text-primary underline">
                  How to print
                </AdminLink>
              </>
            )}
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs font-medium text-red-600">
            Label pictures didn&apos;t load: {error}{" "}
            <button type="button" onClick={retry} className="inline-flex min-h-11 items-center px-1 font-bold underline">
              Try again
            </button>
          </span>
        )}
        {problem && files && (
          <span role="status" className="text-xs font-medium text-red-600">
            {problem}{" "}
            <button
              type="button"
              onClick={() => openNext(flow.next ?? 0)}
              className="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline"
            >
              Open picture
            </button>
          </span>
        )}
      </span>
    </span>
  );
}
