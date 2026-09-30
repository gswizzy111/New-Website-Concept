"use client";

import { useEffect, useState } from "react";

function getNext3PMET(): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
  const hh = get("hour"), mm = get("minute"), ss = get("second");
  const currentSecs = hh * 3600 + mm * 60 + ss;
  const targetSecs = 15 * 3600; // 3:00 PM

  let secsUntil: number;
  if (currentSecs < targetSecs) {
    secsUntil = targetSecs - currentSecs;
  } else {
    secsUntil = (24 * 3600 - currentSecs) + targetSecs;
  }
  return new Date(now.getTime() + secsUntil * 1000);
}

function formatCountdown(ms: number) {
  if (ms <= 0) return { hours: 0, minutes: 0, seconds: 0 };
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  return { hours, minutes, seconds };
}

export function CountdownBanner() {
  const [target] = useState(() => getNext3PMET());
  const [msLeft, setMsLeft] = useState(() => target.getTime() - Date.now());

  useEffect(() => {
    const tick = () => setMsLeft(target.getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const { hours, minutes, seconds } = formatCountdown(msLeft);
  const isOpen = msLeft <= 0;

  if (isOpen) {
    return (
      <div className="bg-rx text-primary-foreground">
        <div className="max-w-5xl mx-auto px-6 py-4 text-center">
          <p className="text-sm font-bold">
            ✅ We&apos;re open! Slots are now available — choose your tier below.
          </p>
        </div>
      </div>
    );
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="bg-ink text-paper">
      <div className="max-w-5xl mx-auto px-6 py-5 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.12em] mb-3 text-paper/80">
          Shop Re-Opening Today at 3:00 PM ET
        </p>
        <div className="flex items-center justify-center gap-3">
          {[
            { value: pad(hours), label: "Hours" },
            { value: pad(minutes), label: "Min" },
            { value: pad(seconds), label: "Sec" },
          ].map(({ value, label }, i) => (
            <div key={label} className="flex items-center gap-3">
              {i > 0 && <span className="text-2xl font-bold text-paper/50">:</span>}
              <div className="flex flex-col items-center">
                <span className="font-heading text-4xl font-bold tabular-nums leading-none">{value}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/70 mt-1">{label}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3 text-paper/75">
          20 Bronze slots · 30 slots for all other tiers — first come, first served
        </p>
      </div>
    </div>
  );
}
