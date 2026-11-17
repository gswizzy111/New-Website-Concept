"use client";

import { useEffect, useState } from "react";

// The closed-restorations countdown from thecarddoc1.com: counts down to the
// next 3:00 PM New York time, then says the shop is open.

function getNext3PMET(): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
  // "24" is midnight in some engines' hour12: false output
  const hh = get("hour") % 24, mm = get("minute"), ss = get("second");
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
  // Worked out in the browser only, so the server's clock never shows (and
  // the first render matches the server's)
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    const target = getNext3PMET();
    const tick = () => setMsLeft(target.getTime() - Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  const isOpen = msLeft !== null && msLeft <= 0;

  if (isOpen) {
    return (
      <div className="bg-success text-white">
        <div className="wrap py-4 text-center">
          <p role="status" className="text-[15px] font-bold">
            ✅ We&apos;re open! Slots are now available — choose your tier below.
          </p>
        </div>
      </div>
    );
  }

  const { hours, minutes, seconds } = formatCountdown(msLeft ?? 0);
  const pad = (n: number) => (msLeft === null ? "--" : String(n).padStart(2, "0"));

  return (
    <div className="surface-ink">
      <div className="wrap py-5 text-center md:py-6">
        <p className="label-caps mb-3 text-[15px] text-sun">
          Shop Re-Opening Today at 3:00 PM ET
        </p>
        <div className="flex items-center justify-center gap-3">
          {[
            { value: pad(hours), label: "Hours" },
            { value: pad(minutes), label: "Min" },
            { value: pad(seconds), label: "Sec" },
          ].map(({ value, label }, i) => (
            <div key={label} className="flex items-center gap-3">
              {i > 0 && <span className="font-display text-[32px] font-black leading-none text-white/50">:</span>}
              <div className="flex min-w-[3.25rem] flex-col items-center">
                <span className="font-display text-[44px] font-black leading-none tabular-nums text-white md:text-[52px]">{value}</span>
                <span className="label-caps mt-1 text-[12px] text-white/70">{label}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-white/80">
          20 Bronze slots · 30 slots for all other tiers — first come, first served
        </p>
      </div>
    </div>
  );
}
