"use client";

import { useMemo, useSyncExternalStore } from "react";
import QRCode from "qrcode";

/**
 * QR code for the Show Dropoffs form, so a customer can scan it at the table
 * and fill the form in on their own phone. `path` is the form's address on
 * this site (with ?show= when there is one); the site's own origin is read in
 * the browser, so it works on any domain. Drawn as one SVG path (no images,
 * no network).
 */
export function DropoffQr({ path, size = 220, label = "QR code for the Show Dropoffs form" }: { path: string; size?: number; label?: string }) {
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const url = origin ? `${origin}${path}` : "";

  const qr = useMemo(() => {
    if (!url) return null;
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    const n = modules.size;
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { n, d };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="rounded-2xl bg-white p-3 shadow-[0_0_0_1px_var(--line)]"
        style={{ width: size + 24, height: size + 24 }}
      >
        {qr && (
          <svg
            role="img"
            aria-label={label}
            width={size}
            height={size}
            viewBox={`-2 -2 ${qr.n + 4} ${qr.n + 4}`}
            shapeRendering="crispEdges"
          >
            <rect x={-2} y={-2} width={qr.n + 4} height={qr.n + 4} fill="#fff" />
            <path d={qr.d} fill="#0b0f1a" />
          </svg>
        )}
      </div>
      {url && <p className="max-w-[18rem] break-all text-center text-xs text-ink-soft">{url.replace(/^https?:\/\//, "")}</p>}
    </div>
  );
}
