"use client";

import { useState, useRef } from "react";
import { X, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { MAX_CARD_PHOTOS } from "@/lib/site-config";
import { cta } from "@/components/brand";

interface Card {
  id: string;
  card_name: string;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  estimated_value_cents: number | null;
  notes: string | null;
  photo_urls: string[];
}

interface Props {
  orderId: string;
  initialCards: Card[];
  locked: boolean;
  lockReason?: string;
}

function PhotoEditor({
  urls,
  onChange,
  disabled,
}: {
  urls: string[];
  onChange: (u: string[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const MAX = MAX_CARD_PHOTOS;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || disabled) return;
    const remaining = MAX - urls.length;
    if (remaining <= 0) return;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    setUploadError("");
    const newUrls: string[] = [];
    try {
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.url === "string") newUrls.push(data.url);
        else setUploadError(data.error ?? (res.status === 413 ? "File too large." : "Upload failed. Please try again."));
      }
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      if (newUrls.length > 0) onChange([...urls, ...newUrls]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {urls.map((url) => (
        <div key={url} className="group relative size-16 overflow-hidden rounded-[10px] shadow-[0_0_0_1px_var(--line)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full object-cover" />
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(urls.filter((u) => u !== url))}
              aria-label="Remove photo"
              className="absolute inset-0 flex items-center justify-center bg-ink/60 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          )}
        </div>
      ))}
      {!disabled && urls.length < MAX && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload photos"
          className="flex size-16 items-center justify-center rounded-[10px] border-2 border-dashed border-ink/25 bg-chalk text-ink-soft transition-colors hover:border-cobalt hover:text-cobalt disabled:opacity-50"
        >
          {uploading ? <span className="text-xs">...</span> : <Upload className="h-4 w-4" />}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {uploadError && <p className="w-full text-xs font-semibold text-destructive">{uploadError}</p>}
    </div>
  );
}

export function CardEditor({ orderId, initialCards, locked, lockReason }: Props) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  function updateCard(id: string, patch: Partial<Card>) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setDirty(true);
  }

  async function save() {
    if (locked || saving) return;
    setSaving(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/cards`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards }),
      });
      if (res.ok) {
        setFlash({ type: "success", msg: "Changes saved successfully." });
        setDirty(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setFlash({ type: "error", msg: data.error ?? "Save failed. Please try again." });
      }
    } catch {
      setFlash({ type: "error", msg: "Save failed. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  if (locked) {
    return (
      <div className="rounded-[14px] bg-sun-tint p-4 text-sm text-ink">
        <p className="font-semibold mb-1">Cards locked</p>
        <p>{lockReason ?? "Your package is in transit and can no longer be edited."}</p>
        <div className="mt-3 flex flex-col gap-2">
          {cards.map((card, i) => (
            <div key={card.id} className="flex gap-2">
              <span className="w-5 shrink-0 pt-0.5 text-xs font-bold text-ink-soft">{i + 1}.</span>
              <span className="font-medium text-sm">{card.card_name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[14px] bg-cobalt-wash px-4 py-3 text-sm text-cobalt-deep">
        You can edit your card details below until your package is picked up by the carrier.
      </div>

      {cards.map((card, i) => {
        const open = expanded[card.id] ?? false;
        return (
          <div key={card.id} className="overflow-hidden rounded-[16px] shadow-[0_0_0_1px_var(--line)]">
            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [card.id]: !open }))}
              aria-expanded={open}
              className="flex min-h-14 w-full items-center justify-between bg-white px-5 py-4 text-left transition-colors hover:bg-chalk"
            >
              <div>
                <span className="label-caps mr-2.5 text-[14px] text-cobalt">Card {i + 1}</span>
                <span className="text-[15px] font-semibold text-ink">{card.card_name || "Unnamed card"}</span>
              </div>
              {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>

            {open && (
              <div className="flex flex-col gap-4 border-t border-line bg-white px-5 pt-4 pb-5">
                <Field label="Card Name *">
                  <input
                    type="text"
                    value={card.card_name}
                    onChange={(e) => updateCard(card.id, { card_name: e.target.value })}
                    className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Set / Edition">
                    <input
                      type="text"
                      value={card.card_set ?? ""}
                      onChange={(e) => updateCard(card.id, { card_set: e.target.value || null })}
                      className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
                    />
                  </Field>
                  <Field label="Year">
                    <input
                      type="text"
                      value={card.card_year ?? ""}
                      onChange={(e) => updateCard(card.id, { card_year: e.target.value || null })}
                      className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
                    />
                  </Field>
                </div>
                <Field label="Estimated Value ($)">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={card.estimated_value_cents != null ? card.estimated_value_cents / 100 : ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      updateCard(card.id, { estimated_value_cents: isNaN(v) ? null : Math.round(v * 100) });
                    }}
                    className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
                    placeholder="0"
                  />
                </Field>
                <Field label="Notes for us">
                  <textarea
                    value={card.notes ?? ""}
                    onChange={(e) => updateCard(card.id, { notes: e.target.value || null })}
                    rows={2}
                    className="w-full resize-none py-2.5 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
                    placeholder="Any special instructions for this card…"
                  />
                </Field>
                <Field label="Photos">
                  <PhotoEditor
                    urls={card.photo_urls}
                    onChange={(urls) => updateCard(card.id, { photo_urls: urls })}
                    disabled={false}
                  />
                </Field>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={cta({ tone: "sun", size: "md" })}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {flash && (
          <p className={`text-sm font-semibold ${flash.type === "success" ? "text-success" : "text-destructive"}`}>
            {flash.msg}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      {children}
    </div>
  );
}
