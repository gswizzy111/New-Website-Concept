"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { uploadPhotos } from "@/app/admin/orders/[id]/upload-photos";
import { UNPAID_CONFIRM } from "../_components/payment";

const TIER_OPTIONS = [
  { value: "prep", label: "Prep" },
  { value: "regular", label: "Bronze restoration" },
  { value: "expedited", label: "Silver restoration" },
  { value: "premium", label: "Gold restoration" },
  { value: "ultra_premium", label: "Platinum restoration" },
  { value: "elite", label: "Diamond restoration" },
  { value: "fast_pass", label: "Fast Pass restoration" },
] as const;

/**
 * In-person drop-off: add a card the customer brought to this order (name,
 * set, number, tier, a photo) and receive it right away. The photo is a
 * receiving photo; the order keeps its other cards and its number.
 */
export function AddCardForm({ orderId, orderTier, today, maxPhotos, unpaid }: {
  orderId: string; orderTier: string | null; today: string; maxPhotos: number;
  /** The order isn't paid: receiving asks to confirm first */
  unpaid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [set, setSet] = useState("");
  const [number, setNumber] = useState("");
  const [year, setYear] = useState("");
  const [tier, setTier] = useState(orderTier && TIER_OPTIONS.some((o) => o.value === orderTier) ? orderTier : "");
  const [receiveNow, setReceiveNow] = useState(true);
  const [receivedOn, setReceivedOn] = useState(today);
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, maxPhotos - photos.length));
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError("");
    const previews = files.map((f) => URL.createObjectURL(f));
    const { urls, error: uploadError } = await uploadPhotos(files);
    setUploading(false);
    if (uploadError) setError(uploadError);
    // uploadPhotos keeps the order of the files that made it; match previews by position when all did
    setPhotos((p) => [...p, ...urls.map((url, i) => ({ url, preview: urls.length === files.length ? previews[i] : url }))]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    if (!name.trim()) return setError("Enter the card's name.");
    if (!tier) return setError("Pick the card's tier.");
    if (receiveNow && (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || receivedOn > today)) return setError("Enter the day the card arrived (today or earlier).");
    if (receiveNow && unpaid && !confirm(UNPAID_CONFIRM)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/intake/orders/${orderId}/add-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_name: name.trim(),
        card_set: set.trim() || null,
        card_number: number.trim() || null,
        card_year: year.trim() || null,
        tier,
        receiving_photo_urls: photos.map((p) => p.url),
        receive: receiveNow,
        receivedOn: receiveNow ? receivedOn : undefined,
        ...(receiveNow && unpaid ? { allowUnpaid: true } : {}),
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(data.error ?? (res ? `Couldn't add the card (${res.status}).` : "Network error. The card wasn't added."));
      if (data.card_id) router.refresh(); // added, but receiving it failed
      return;
    }
    setDone(typeof data.summary === "string" ? `Added ${name.trim()}. ${data.summary}` : `Added ${name.trim()}${data.card_code ? ` (${data.card_code})` : ""}.`);
    setName("");
    setSet("");
    setNumber("");
    setYear("");
    setPhotos([]);
    router.refresh();
    // Ready for the next card the customer brought
    nameInput.current?.focus();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-4 rounded-lg border-2 border-dashed border-border bg-white text-sm font-bold text-foreground hover:border-primary/50 w-full sm:w-auto">
        + Add a card (in-person drop-off)
      </button>
    );
  }

  const field = "h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm w-full";
  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-black text-base text-foreground">Add a card</h3>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm font-bold text-muted-foreground hover:text-foreground">Close</button>
      </div>
      <p className="text-xs text-muted-foreground">For a card the customer brings in person. It joins this order (no new order) and gets its own Card ID.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground sm:col-span-2">Card name<input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={200} required /></label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Set<input value={set} onChange={(e) => setSet(e.target.value)} className={field} maxLength={200} /></label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Card number<input value={number} onChange={(e) => setNumber(e.target.value)} className={field} maxLength={40} /></label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Year<input value={year} onChange={(e) => setYear(e.target.value)} className={field} maxLength={20} inputMode="numeric" /></label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={field} required>
            {!tier && <option value="">Pick a tier…</option>}
            {TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground mb-1.5">Photo</p>
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((p, i) => (
            <span key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`New card photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-border" />
              <button type="button" onClick={() => setPhotos((list) => list.filter((x) => x.url !== p.url))} className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold" aria-label={`Remove new card photo ${i + 1}`}>×</button>
            </span>
          ))}
          {photos.length < maxPhotos && (
            <>
              <button type="button" onClick={() => camera.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
                <Camera className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Take photo
              </button>
              <button type="button" onClick={() => library.current?.click()} disabled={uploading} className="min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold disabled:opacity-50">Choose photo</button>
            </>
          )}
          {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={addPhotos} />
          <input ref={library} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={addPhotos} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-foreground cursor-pointer">
          <input type="checkbox" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} className="w-6 h-6 accent-primary" />
          Received now
        </label>
        {receiveNow && (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Received on
            <input type="date" value={receivedOn} max={today} min="2020-01-01" onChange={(e) => setReceivedOn(e.target.value)} className="h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm" />
          </label>
        )}
      </div>

      <button type="submit" disabled={busy || uploading} className="min-h-12 px-5 rounded-lg bg-primary text-primary-foreground text-base font-black disabled:opacity-50">
        {busy ? "Adding…" : receiveNow ? "Add and receive card" : "Add card"}
      </button>
      {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
      {done && <p role="status" className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm font-semibold text-green-800">{done}</p>}
    </form>
  );
}
