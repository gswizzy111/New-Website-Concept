"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { CatalogLangStatus } from "@/lib/card-catalog-sync";

const LANG_NAMES: Record<string, string> = { en: "English", ja: "Japanese" };

function when(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const n = (x: number) => x.toLocaleString("en-US");

type SyncResponse = {
  result?: { done: boolean; setsSynced: number; cardsSaved: number; setsLeft: number; listsChecked: number };
  status?: CatalogLangStatus[];
  error?: string;
};

/** The catalog's numbers per language, and "Sync now", which runs chunks until nothing is left. */
export function CatalogSync({ initial }: { initial: CatalogLangStatus[] }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ sets: number; cards: number; left: number | null } | null>(null);
  const [message, setMessage] = useState("");
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; }, []);

  async function syncNow() {
    stop.current = false;
    setRunning(true);
    setMessage("");
    let sets = 0;
    let cards = 0;
    setProgress({ sets, cards, left: null });
    try {
      for (let chunk = 0; chunk < 60 && !stop.current; chunk++) {
        const res = await fetch("/api/admin/card-catalog/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshLists: chunk === 0 }),
        });
        const data = (await res.json().catch(() => ({}))) as SyncResponse;
        if (!res.ok || !data.result) {
          setMessage(data.error ?? "The sync stopped with an error. Try again in a minute.");
          break;
        }
        if (data.status) setStatus(data.status);
        sets += data.result.setsSynced;
        cards += data.result.cardsSaved;
        setProgress({ sets, cards, left: data.result.setsLeft });
        if (data.result.done) {
          setMessage(sets > 0 ? `Done: ${n(sets)} sets, ${n(cards)} cards updated.` : "Everything is already up to date.");
          break;
        }
        if (data.result.setsSynced === 0 && data.result.listsChecked === 0) {
          setMessage("Some sets couldn't be synced right now (see below). The next automatic run tries them again.");
          break;
        }
      }
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const errors = status.flatMap((s) => s.errors.map((e) => ({ ...e, lang: s.lang })));

  return (
    <div className="bg-white rounded-xl border border-border p-6 flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {status.map((s) => {
          const pct = s.cards > 0 ? Math.round((s.images / s.cards) * 100) : 0;
          return (
            <div key={s.lang} className="rounded-lg border border-border p-4 flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{LANG_NAMES[s.lang] ?? s.lang}</p>
              <p className="font-heading font-black text-3xl text-foreground tabular-nums">{n(s.cards)} <span className="text-base font-semibold text-muted-foreground">cards</span></p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">With a picture</dt>
                <dd className="text-foreground tabular-nums">{n(s.images)} ({pct}%)</dd>
                {s.legacyImages > 0 && (
                  <>
                    <dt className="text-muted-foreground">Pictures from backup source</dt>
                    <dd className="text-foreground tabular-nums">{n(s.legacyImages)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Sets synced</dt>
                <dd className="text-foreground tabular-nums">{n(s.setsSynced)} of {n(s.sets)}</dd>
                <dt className="text-muted-foreground">Last sync</dt>
                <dd className="text-foreground">{when(s.lastSync)}</dd>
                <dt className="text-muted-foreground">Set list checked</dt>
                <dd className="text-foreground">{when(s.listCheckedAt)}</dd>
              </dl>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={running ? () => { stop.current = true; } : syncNow}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={1.75} aria-hidden />
          {running ? "Stop" : "Sync now"}
        </button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {running && progress
            ? `Syncing… ${n(progress.sets)} sets, ${n(progress.cards)} cards so far${progress.left !== null ? `, ${n(progress.left)} sets to go` : ""}. Keep this page open.`
            : message}
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">Not synced yet ({errors.length})</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {errors.slice(0, 20).map((e) => (
              <li key={`${e.lang}:${e.set_id}`}>
                {LANG_NAMES[e.lang] ?? e.lang} · {e.set_id === "_list" ? "set list" : e.set_name ?? e.set_id}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
