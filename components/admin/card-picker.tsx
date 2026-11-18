"use client";

// The card picker on the admin card forms (manual order, Add Card, Edit Card):
// the card name box doubles as a search of the card catalog (lib/card-catalog.ts).
// Typing shows matching cards as thumbnails; picking one fills the form and
// shows the card's reference picture. Typing a name and moving on still works
// for any card the catalog doesn't have.
//
// Searches wait 200 ms after the last key, cancel the one before, and are
// remembered for the page's life, so going back over a search is instant.

import { useEffect, useId, useRef, useState } from "react";
import { ImageOff, Search, X } from "lucide-react";
import {
  catalogDisplayName,
  catalogNumber,
  catalogYear,
  normalizeCatalogText,
  SEARCH_MAX,
  SEARCH_MIN,
  type CatalogCard,
} from "@/lib/card-catalog";

const DEBOUNCE_MS = 200;
const results = new Map<string, CatalogCard[]>();

type Status = "idle" | "loading" | "done" | "error";

export type ReferencePick = {
  /** The catalog picture (large). */
  imageUrl: string | null;
  /** A line about the card under the picture, e.g. "Base Set · 1999 · #4/102". */
  caption?: string | null;
};

export function CardPicker({
  value,
  onChange,
  onPick,
  picked,
  onClear,
  inputClassName,
  placeholder,
  autoFocus,
  inputId,
  ariaLabel,
  size = "md",
}: {
  /** The card name box's text. */
  value: string;
  /** Typing in the box (manual entry). */
  onChange: (text: string) => void;
  onPick: (card: CatalogCard) => void;
  /** The catalog card linked now, if any. */
  picked: ReferencePick | null;
  onClear: () => void;
  inputClassName: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputId?: string;
  ariaLabel?: string;
  /** "sm" keeps the reference picture small, for long lists of cards. */
  size?: "sm" | "md";
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  // Results whose thumbnail link is dead: they show "No picture" instead of an empty box
  const [deadThumbs, setDeadThumbs] = useState<Set<string>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
  }, []);

  // Keep the highlighted card in view
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
    const q = normalizeCatalogText(text);
    if (q.length < SEARCH_MIN || text.trim().length > SEARCH_MAX) {
      setOpen(false);
      setStatus("idle");
      setCards([]);
      setActive(-1);
      return;
    }
    const known = results.get(q);
    if (known) {
      setCards(known);
      setStatus("done");
      setActive(-1);
      setOpen(true);
      return;
    }
    setStatus("loading");
    setOpen(true);
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      request.current = controller;
      try {
        const res = await fetch(`/api/admin/card-catalog/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(res.status === 401 ? "Your sign-in has ended. Sign in again to search cards." : data.error ?? "Card search isn't available right now. You can still type the card in.");
          setStatus("error");
          setCards([]);
          return;
        }
        const found = (data.cards ?? []) as CatalogCard[];
        if (results.size > 200) results.clear();
        // Empty answers aren't kept: right after a deploy the catalog is still filling
        if (found.length > 0) results.set(q, found);
        setCards(found);
        setStatus("done");
        setActive(-1);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError("Card search isn't available right now. You can still type the card in.");
        setStatus("error");
        setCards([]);
      }
    }, DEBOUNCE_MS);
  }

  function choose(card: CatalogCard) {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
    setOpen(false);
    setActive(-1);
    onPick(card);
  }

  function close() {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
    setOpen(false);
    setActive(-1);
  }

  /** How many thumbnails sit in one row of the results. */
  function columns() {
    const grid = gridRef.current;
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = cards.length;
    const showing = open && status === "done" && n > 0;
    if (e.key === "ArrowDown") {
      if (!showing) {
        if (cards.length > 0) { setOpen(true); e.preventDefault(); }
        return;
      }
      e.preventDefault();
      setActive((i) => (i < 0 ? 0 : Math.min(n - 1, i + columns())));
    } else if (e.key === "ArrowUp" && showing) {
      e.preventDefault();
      setActive((i) => (i < 0 ? -1 : i - columns() < 0 ? -1 : i - columns()));
    } else if (e.key === "ArrowRight" && showing && active >= 0) {
      e.preventDefault();
      setActive((i) => Math.min(n - 1, i + 1));
    } else if (e.key === "ArrowLeft" && showing && active >= 0) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open) {
      // Picks the highlighted card. With the results open it never submits the
      // form around the box (the manual order form would create the order)
      e.preventDefault();
      if (showing && active >= 0) choose(cards[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
  }

  const activeId = open && active >= 0 ? `${listId}-${active}` : undefined;
  const thumb = size === "sm" ? "w-16" : "w-28";

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" strokeWidth={1.75} aria-hidden />
          <input
            id={inputId}
            className={`${inputClassName} pl-9`}
            value={value}
            onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
            onKeyDown={onKeyDown}
            onBlur={close}
            onFocus={() => { if (cards.length > 0 && status === "done" && normalizeCatalogText(value).length >= SEARCH_MIN && !picked) setOpen(true); }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId}
          />
        </div>

        {open && (
          // In the page's flow, not floating: the admin card panels clip anything that overflows them
          <div
            className="mt-1.5 rounded-xl border border-border bg-white shadow-sm overflow-hidden"
            // Clicks inside keep the focus in the name box
            onMouseDown={(e) => e.preventDefault()}
          >
            {status === "loading" && cards.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">Searching the card catalog…</p>
            )}
            {status === "error" && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
            {status === "done" && cards.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">No cards match. Try fewer words, or the card number.</p>
            )}
            <div
              id={listId}
              ref={gridRef}
              role="listbox"
              aria-label="Cards in the catalog"
              className={`grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5 p-1.5 max-h-[22rem] overflow-y-auto overscroll-contain ${status === "loading" ? "opacity-60" : ""} ${cards.length === 0 ? "hidden" : ""}`}
            >
              {cards.map((card, i) => {
                const year = catalogYear(card);
                return (
                  <div
                    key={card.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(card)}
                    className={`flex flex-col gap-1 rounded-lg p-1.5 cursor-pointer border transition-colors ${i === active ? "border-primary bg-primary/5" : "border-transparent hover:bg-secondary"}`}
                  >
                    <div className="relative w-full aspect-[63/88] rounded-md bg-secondary overflow-hidden">
                      {card.image_small && !deadThumbs.has(card.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={card.image_small}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={() => setDeadThumbs((prev) => new Set(prev).add(card.id))}
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      ) : (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground text-center px-1">
                          <ImageOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                          No picture
                        </span>
                      )}
                      {card.lang === "ja" && (
                        <span className="absolute top-1 left-1 text-[9px] font-bold px-1 py-px rounded bg-foreground text-background">JA</span>
                      )}
                    </div>
                    <p className="text-[11px] font-semibold leading-tight text-foreground line-clamp-2">{catalogDisplayName(card)}</p>
                    <p className="text-[10px] leading-tight text-muted-foreground line-clamp-2">
                      {card.set_name}{year ? ` · ${year}` : ""}
                    </p>
                    <p className="text-[10px] leading-tight text-muted-foreground truncate">
                      #{catalogNumber(card)}{card.rarity ? ` · ${card.rarity}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 bg-secondary/40">
              <button type="button" onClick={close} className="inline-flex items-center min-h-11 sm:min-h-0 text-xs font-semibold text-primary hover:text-primary/80">
                Not in the list? Type it in
              </button>
              {cards.length > 0 && <span className="hidden sm:inline text-[10px] text-muted-foreground">Arrow keys and Enter to pick</span>}
            </div>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {open && status === "done" ? (cards.length === 0 ? "No cards match." : `${cards.length} cards found.`) : ""}
        </p>
      </div>

      {/* Keyed by the picture, so a picture that failed to load doesn't hide the next one */}
      {picked && <ReferencePhoto key={picked.imageUrl ?? ""} picked={picked} onClear={onClear} thumbClass={thumb} />}
    </div>
  );
}

function ReferencePhoto({ picked, onClear, thumbClass }: { picked: ReferencePick; onClear: () => void; thumbClass: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-dashed border-border bg-secondary/30 p-2">
      {picked.imageUrl && !broken ? (
        <a href={picked.imageUrl} target="_blank" rel="noopener noreferrer" className={`${thumbClass} shrink-0`} title="Open the full-size picture">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.imageUrl}
            alt="Reference photo of the catalog card"
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="w-full aspect-[63/88] object-contain rounded-md bg-white"
          />
        </a>
      ) : (
        <span className={`${thumbClass} shrink-0 aspect-[63/88] rounded-md bg-white border border-border flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground text-center px-1`}>
          <ImageOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          No picture
        </span>
      )}
      {/* Drops under the picture when the column is too narrow (Edit Card on a phone) */}
      <div className="flex flex-col gap-1 min-w-[7.5rem] flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reference photo</p>
        <p className="text-[11px] text-muted-foreground leading-snug">From the card catalog, not the customer&apos;s card.</p>
        {picked.caption && <p className="text-xs text-foreground leading-snug">{picked.caption}</p>}
        <button
          type="button"
          onClick={onClear}
          className="self-start inline-flex items-center gap-1 py-1 min-h-11 sm:min-h-0 text-xs font-semibold text-red-600 hover:text-red-700"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Clear
        </button>
      </div>
    </div>
  );
}

/** "Base Set · 1999 · #4/102 · Rare" for the line under a picked card's picture. */
export function pickCaption(card: CatalogCard): string {
  return [card.lang === "ja" ? `${card.set_name} (Japanese)` : card.set_name, catalogYear(card), `#${catalogNumber(card)}`, card.rarity]
    .filter(Boolean)
    .join(" · ");
}
