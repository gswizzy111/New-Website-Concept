"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bagSentences, orderCompletionNotes, type ToneLine } from "@/lib/intake/tracking/bag-home";
import type { TrackBagPlace } from "@/lib/intake/tracking/types";

export function CardCompletionToggle({
  cardId,
  initialCompleted,
}: {
  cardId: string;
  initialCompleted: boolean;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  // The same card can show twice (card list and stage tracker): follow the
  // server's value after a refresh so both stay in step
  const [shown, setShown] = useState(initialCompleted);
  if (shown !== initialCompleted) {
    setShown(initialCompleted);
    setCompleted(initialCompleted);
  }
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // After Done: where its bag is ("Put it back in REYES's bag: Open bags box, under R.")
  const [bagLine, setBagLine] = useState<string | null>(null);
  // The order's last card done: the order was completed ("Order completed. Pat emailed.")
  const [notes, setNotes] = useState<ToneLine[]>([]);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    setErr(null);
    setBagLine(null);
    setNotes([]);
    try {
      const res = await fetch(`/api/admin/cards/${cardId}/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCompleted(data.completed);
        if (data.completed === true) {
          setBagLine(bagSentences(Array.isArray(data.bagPlaces) ? (data.bagPlaces as TrackBagPlace[]) : [], 1) || null);
          setNotes(orderCompletionNotes([data.orderCompletion]));
        }
        // Refresh so the done counts and the other sections update
        router.refresh();
      } else {
        setErr(data.error ?? "Failed");
      }
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={toggle}
        disabled={loading}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
          completed
            ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
            : "bg-white text-muted-foreground border-border hover:border-foreground"
        } disabled:opacity-50`}
      >
        <span
          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            completed ? "bg-green-500 border-green-500" : "border-gray-300"
          }`}
        >
          {completed && (
            <svg viewBox="0 0 10 8" fill="none" className="w-2 h-2">
              <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {loading ? "…" : completed ? "Done" : "Mark Done"}
      </button>
      {err && <p className="text-xs text-red-500 max-w-[180px] text-right">{err}</p>}
      {(bagLine || notes.length > 0) && (
        <div role="status" className="flex flex-col items-end gap-0.5 max-w-[220px] text-right text-xs font-semibold">
          {bagLine && <p className="text-foreground">{bagLine}</p>}
          {notes.map((n) => <p key={n.text} className={n.tone === "ok" ? "text-green-700" : "text-amber-700"}>{n.text}</p>)}
        </div>
      )}
    </div>
  );
}
