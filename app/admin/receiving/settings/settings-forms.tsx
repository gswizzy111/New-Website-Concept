"use client";

import { useMemo, useState } from "react";
import { LabelPreview } from "@/components/intake/label-preview";
import { bagLabelCapacity, layoutBagLabel } from "@/lib/intake/labels/layout";
import { layoutPlaceLabel, type LabelPlace } from "@/lib/intake/labels/place";
import {
  DEFAULT_CONTENT_WIDTH_IN,
  LABEL_STOCKS,
  PLACE_LABEL_STOCK,
  fullWidthPoints,
  isFullWidthStock,
  stockPoints,
  stockWidthRange,
  type LabelStockId,
} from "@/lib/intake/labels/stock";
import type { LabelBag } from "@/lib/intake/labels/types";

type Holiday = { day: string; name: string };
type SettingsState = { labels: { stock: LabelStockId; contentWidthIn: number }; holidays: Holiday[]; holidaysError: string | null };

const input = "h-11 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1.5";

async function patch(body: unknown): Promise<SettingsState> {
  const res = await fetch("/api/admin/intake/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Save failed.");
  return data as SettingsState;
}

/** A made-up bag (in an order with a second bag), only to show how the label lays out on this stock. */
function sampleBag(cards: number): LabelBag {
  return {
    bagCode: "CD-0000-P",
    tierName: "Platinum",
    orderNumber: "CD-0000",
    customerName: "Sample Customer",
    receivedOn: "2026-11-16",
    dueDate: "2026-12-08",
    otherBags: [{ bagCode: "CD-0000-G", tierName: "Gold", cardCount: 2 }],
    cards: Array.from({ length: cards }, (_, i) => ({
      seq: i + 1,
      code: `CD-0000-${String(i + 1).padStart(2, "0")}`,
      name: `Sample card ${i + 1}`,
      year: "1999",
      set: "Sample Set",
      number: String(i + 1),
    })),
  };
}

/** Label stock and print width (store_config), with a sample label at the chosen size. */
export function LabelSettingsForm({ initial }: { initial: { stock: LabelStockId; contentWidthIn: number } }) {
  const [stock, setStock] = useState<LabelStockId>(initial.stock);
  const [width, setWidth] = useState(String(initial.contentWidthIn));
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { min: minW, max: maxW } = stockWidthRange(stock);
  // 50 x 80 mm prints across the whole label: no width to pick
  const fullWidth = isFullWidthStock(stock);
  const n = fullWidth ? maxW : parseFloat(width);
  const valid = Number.isFinite(n) && n >= minW && n <= maxW;
  const dirty = stock !== saved.stock || n !== saved.contentWidthIn;

  const sample = useMemo(() => {
    if (!valid) return null;
    const pts = stockPoints(stock, n);
    return { ...bagLabelCapacity(pts), page: layoutBagLabel(sampleBag(4), pts) };
  }, [stock, n, valid]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setMessage(null);
    try {
      const s = await patch({ labels: { stock, contentWidthIn: n } });
      setSaved(s.labels);
      setWidth(String(s.labels.contentWidthIn));
      setMessage({ ok: true, text: "Saved. Labels print this way from now on." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 md:grid-cols-[1fr_auto]">
      <div className="flex flex-col gap-5">
        <fieldset>
          <legend className={labelCls}>Label stock in the printer</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LABEL_STOCKS) as LabelStockId[]).map((id) => (
              <label
                key={id}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold ${stock === id ? "border-primary bg-primary/5 text-foreground" : "border-border bg-white text-muted-foreground"}`}
              >
                <input
                  type="radio"
                  name="stock"
                  value={id}
                  checked={stock === id}
                  onChange={() => {
                    setStock(id);
                    const range = stockWidthRange(id);
                    const w = parseFloat(width);
                    if (isFullWidthStock(id)) setWidth(String(range.max));
                    else if (!(w >= range.min && w <= range.max)) setWidth(String(Math.max(range.min, Math.min(DEFAULT_CONTENT_WIDTH_IN, LABEL_STOCKS[id].widthIn - 0.4))));
                  }}
                  className="size-4"
                />
                {LABEL_STOCKS[id].name}
                {id === "4x6" && <span className="text-xs font-normal text-muted-foreground">(default)</span>}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {LABEL_STOCKS[stock].printer === "Katasymbol"
              ? "50 × 80 mm labels print from the Katasymbol app on the phone."
              : "Load the same size in the Labelife printer (and relearn the gap after changing rolls)."}
          </p>
        </fieldset>

        {fullWidth ? (
          <p className="text-sm text-foreground">Prints across the whole 50 mm label, 2.5 mm in from each side.</p>
        ) : (
          <div>
            <label htmlFor="content-width" className={labelCls}>Printed width (inches)</label>
            <input
              id="content-width"
              className={`${input} w-32`}
              type="number"
              inputMode="decimal"
              step="0.05"
              min={minW}
              max={maxW}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              aria-invalid={!valid}
            />
            <p className={`text-xs mt-1.5 ${valid ? "text-muted-foreground" : "text-red-600 font-semibold"}`}>
              {valid
                ? `Centered on the ${maxW} in wide label. Default ${DEFAULT_CONTENT_WIDTH_IN} in (about 80% of a 4 in bag).`
                : `Between ${minW} and ${maxW} in.`}
            </p>
          </div>
        )}

        {sample && (
          <p className="text-sm text-foreground">
            One label per bag. It lists up to <strong>{sample.normal}</strong> card{sample.normal === 1 ? "" : "s"} at full size
            {sample.max > sample.normal ? (
              <>
                {" "}and up to <strong>{sample.max}</strong> in smaller type or two columns
              </>
            ) : null}
            ; a bigger bag lists what fits and ends with &ldquo;+N more: scan the QR&rdquo;.
          </p>
        )}

        {message && (
          <p role="status" className={`text-sm font-medium rounded-lg px-4 py-3 border ${message.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}>
            {message.text}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={!valid || !dirty || saving}
            className="min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save label settings"}
          </button>
        </div>
      </div>

      {sample && (
        <figure className="w-[220px] max-w-full">
          <LabelPreview page={sample.page} printed label="Sample bag label at this size" />
          <figcaption className="mt-1 text-xs text-muted-foreground">Sample bag label (made-up customer and cards)</figcaption>
        </figure>
      )}
    </form>
  );
}

/** Made-up places, only to show how slot labels and signs print. */
const SAMPLE_PLACES: { place: LabelPlace; label: string }[] = [
  { place: { code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", stage: "Clamp Work", serial: 7 }, label: "Sample slot label CLAMP 07" },
  { place: { code: "LOC-SHELF-20261207", name: "DUE MON DEC 7", kind: "shelf", dueDate: "2026-12-07" }, label: "Sample shelf sign DUE MON DEC 7" },
];

/** Sample slot label and shelf sign at the size they print (50 x 80 mm on the Katasymbol). */
export function PlaceLabelSamples() {
  const pages = useMemo(() => {
    const stock = fullWidthPoints(PLACE_LABEL_STOCK);
    return SAMPLE_PLACES.map((s) => ({ ...s, page: layoutPlaceLabel(s.place, stock) }));
  }, []);
  return (
    <div className="flex flex-wrap gap-4">
      {pages.map((p) => (
        <figure key={p.place.code} className="w-[150px] max-w-full">
          <LabelPreview page={p.page} printed label={p.label} />
          <figcaption className="mt-1 text-xs text-muted-foreground">{p.place.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function dayText(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** The business_holidays list: add and remove days. */
export function HolidaysEditor({ initial, initialError, fallback }: { initial: Holiday[]; initialError: string | null; fallback: readonly Holiday[] }) {
  const [holidays, setHolidays] = useState(initial);
  const [tableError, setTableError] = useState(initialError);
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(key: string, body: unknown, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      const s = await patch(body);
      setHolidays(s.holidays);
      setTableError(s.holidaysError);
      setMessage({ ok: true, text: done });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!day || !name.trim()) return;
    if (await run("add", { addHoliday: { day, name: name.trim() } }, `Added ${dayText(day)}.`)) {
      setDay("");
      setName("");
    }
  }

  const list = tableError ? fallback : holidays;
  const years = [...new Set(list.map((h) => h.day.slice(0, 4)))];

  return (
    <div className="flex flex-col gap-4">
      {tableError && (
        <p role="alert" className="text-sm rounded-lg px-4 py-3 border border-amber-200 bg-amber-50 text-amber-800">
          The holidays list can&apos;t be read from the database yet ({tableError}). Due dates use the built-in list below until the intake database update is applied; adding or removing days needs it.
        </p>
      )}

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holidays. Weekends are never business days.</p>
      ) : (
        years.map((y) => (
          <div key={y}>
            <h3 className="text-xs font-bold text-muted-foreground mb-1">{y}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {list
                .filter((h) => h.day.startsWith(y))
                .map((h) => (
                  <li key={h.day} className="flex items-center justify-between gap-3 px-3 py-1.5 min-h-11">
                    <span className="text-sm">
                      <span className="font-semibold text-foreground">{dayText(h.day)}</span>
                      <span className="text-muted-foreground"> · {h.name}</span>
                    </span>
                    {!tableError && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => run(`rm-${h.day}`, { removeHoliday: { day: h.day } }, `Removed ${dayText(h.day)}.`)}
                        className="min-h-11 px-3 text-sm font-semibold text-red-600 hover:underline disabled:opacity-50"
                        aria-label={`Remove ${h.name}, ${dayText(h.day)}`}
                      >
                        {busy === `rm-${h.day}` ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}

      {!tableError && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="holiday-day" className={labelCls}>Date</label>
            <input id="holiday-day" type="date" className={input} value={day} onChange={(e) => setDay(e.target.value)} required />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="holiday-name" className={labelCls}>Name</label>
            <input id="holiday-name" className={`${input} w-full`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Day after Thanksgiving" required />
          </div>
          <button type="submit" disabled={busy !== null || !day || !name.trim()} className="min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-50">
            {busy === "add" ? "Adding…" : "Add holiday"}
          </button>
        </form>
      )}

      {message && (
        <p role="status" className={`text-sm font-medium ${message.ok ? "text-green-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
