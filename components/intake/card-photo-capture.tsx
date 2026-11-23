"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { uploadPhotos } from "@/app/admin/orders/[id]/upload-photos";

/**
 * Receiving photos for ONE card (cards.receiving_photo_urls), taken while the
 * card is checked in. On a phone or tablet "Take photo" opens the camera
 * straight away (capture="environment"); "Choose photo" picks one from the
 * library; a desktop with a webcam also gets "Use webcam". The photo shows at
 * once, uploads through /api/upload, then is added to the card by
 * /api/admin/intake/cards/<id>/photos. The customer's own photos
 * (cards.photo_urls) are never touched here. Staff stay on the page, so they
 * can photograph card after card; after a photo is saved, focus moves to the
 * next card's "Take photo" button when `nextButtonId` is given.
 */

type Pending = { key: string; preview: string; status: "uploading" | "failed"; error?: string; file: File };

const noSubscription = () => () => {};
// A desktop browser with a camera API: mouse or trackpad, and getUserMedia
function webcamSupported() {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window !== "undefined"
    && window.matchMedia("(pointer: fine)").matches;
}

export function captureButtonId(cardId: string) {
  return `take-photo-${cardId}`;
}

export function CardPhotoCapture({
  cardId,
  cardLabel,
  photos,
  thumbs,
  max,
  nextButtonId,
}: {
  cardId: string;
  /** e.g. "Card 3, Charizard": read out by screen readers on every button */
  cardLabel: string;
  /** The card's receiving photos as saved */
  photos: string[];
  /** Smaller copies to show in the list (thumbnail() from lib/thumbnail.ts, made on the server), by photo URL */
  thumbs?: Record<string, string>;
  /** How many receiving photos a card may have (MAX_CARD_PHOTOS) */
  max: number;
  /** The next card's "Take photo" button, focused after a photo is saved */
  nextButtonId?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<string[]>(photos);
  const [savedFrom, setSavedFrom] = useState(photos);
  // New props after router.refresh(): take the saved list from the server again
  if (savedFrom !== photos && JSON.stringify(savedFrom) !== JSON.stringify(photos)) {
    setSavedFrom(photos);
    setSaved(photos);
  }
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [webcamOpen, setWebcamOpen] = useState(false);
  // The photo a "Replace" is waiting to swap out (set when the new photo's picker opens)
  const replacing = useRef<string | null>(null);
  // The photo whose "Replace" is being confirmed (inline, so the camera opens from a direct tap)
  const [confirmingReplace, setConfirmingReplace] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const hasWebcam = useSyncExternalStore(noSubscription, webcamSupported, () => false);

  const room = Math.max(0, max - saved.length - pending.filter((p) => p.status === "uploading").length);

  // Object URLs made for previews are freed when the card's panel goes away
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const made = previews.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function save(body: Record<string, unknown>): Promise<string[] | null> {
    const res = await fetch(`/api/admin/intake/cards/${cardId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !Array.isArray(data.receiving_photo_urls)) {
      setError(data.error ?? (res ? `Couldn't save the photo (${res.status}).` : "Network error. The photo wasn't saved."));
      return null;
    }
    return data.receiving_photo_urls as string[];
  }

  async function handleFiles(files: File[], fromCamera: boolean) {
    setError("");
    const swapOut = replacing.current;
    replacing.current = null;
    const wanted = swapOut ? files.slice(0, 1) : files.slice(0, room);
    if (!wanted.length) {
      if (files.length) setError(`A card can have ${max} receiving photos. Remove one first.`);
      return;
    }
    if (!swapOut && files.length > wanted.length) setError(`Only ${wanted.length} more photo${wanted.length === 1 ? "" : "s"} fit on this card (${max} at most).`);

    const items: Pending[] = wanted.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { key: preview, preview, status: "uploading", file };
    });
    setPending((p) => [...p, ...items]);
    setBusy(true);

    let latest: string[] | null = null;
    for (const item of items) {
      const { urls, error: uploadError } = await uploadPhotos([item.file]);
      const url = urls[0];
      if (!url) {
        setPending((p) => p.map((x) => (x.key === item.key ? { ...x, status: "failed", error: uploadError ?? "Upload failed." } : x)));
        setError(uploadError ?? "The photo didn't upload.");
        continue;
      }
      const next = await save(swapOut ? { action: "replace", old: swapOut, url } : { action: "add", urls: [url] });
      if (!next) {
        setPending((p) => p.map((x) => (x.key === item.key ? { ...x, status: "failed", error: "Uploaded, but not saved to the card." } : x)));
        continue;
      }
      latest = next;
      setSaved(next);
      setPending((p) => p.filter((x) => x.key !== item.key));
    }
    setBusy(false);
    if (latest) {
      // Flags at the top of the page ("Missing images") follow the new photos
      router.refresh();
      if (fromCamera && nextButtonId) {
        const next = document.getElementById(nextButtonId);
        if (next instanceof HTMLElement) {
          // Centred, so the sticky "Receive" bar at the bottom doesn't cover it
          next.scrollIntoView({ block: "center", behavior: "smooth" });
          next.focus({ preventScroll: true });
        }
      }
    }
  }

  function retry(item: Pending) {
    setPending((p) => p.filter((x) => x.key !== item.key));
    void handleFiles([item.file], false);
  }

  function dismiss(item: Pending) {
    setPending((p) => p.filter((x) => x.key !== item.key));
  }

  // Confirmed: open the camera (or the library) straight from this tap; the new photo takes the old one's place
  function replaceWith(input: "camera" | "library") {
    replacing.current = confirmingReplace;
    setConfirmingReplace(null);
    (input === "camera" ? cameraInput : libraryInput).current?.click();
  }

  async function remove(url: string) {
    if (!confirm(`Remove this receiving photo from ${cardLabel}? The customer's own photos are not changed.`)) return;
    setBusy(true);
    setError("");
    const next = await save({ action: "remove", url });
    setBusy(false);
    if (next) {
      setSaved(next);
      router.refresh();
    }
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // the same photo can be picked again
    if (!files.length) {
      replacing.current = null;
      return;
    }
    void handleFiles(files, fromCamera);
  }

  const btn = "inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-lg text-sm font-bold transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      {(saved.length > 0 || pending.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label={`Receiving photos of ${cardLabel}`}>
          {saved.map((url, i) => (
            <li key={url} className="flex flex-col items-center gap-1">
              <EnlargeablePhoto url={url} thumb={thumbs?.[url]} alt={`Receiving photo ${i + 1} of ${cardLabel}`} size="md" />
              <div className="flex gap-1">
                <button type="button" onClick={() => { setError(""); setConfirmingReplace(url); }} disabled={busy} className="min-h-11 px-2 text-xs font-bold text-primary hover:underline disabled:opacity-50" aria-label={`Replace receiving photo ${i + 1} of ${cardLabel}`} aria-expanded={confirmingReplace === url}>
                  Replace
                </button>
                <button type="button" onClick={() => remove(url)} disabled={busy} className="min-h-11 px-2 text-xs font-bold text-red-600 hover:underline disabled:opacity-50" aria-label={`Remove receiving photo ${i + 1} of ${cardLabel}`}>
                  Remove
                </button>
              </div>
            </li>
          ))}
          {pending.map((item) => (
            <li key={item.key} className="flex flex-col items-center gap-1">
              <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-secondary/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.preview} alt="" className={`w-full h-full object-cover ${item.status === "uploading" ? "opacity-60" : "opacity-40"}`} />
                <span className={`absolute inset-x-0 bottom-0 text-[10px] font-bold text-center py-0.5 ${item.status === "uploading" ? "bg-white/85 text-foreground" : "bg-red-600 text-white"}`}>
                  {item.status === "uploading" ? "Saving…" : "Not saved"}
                </span>
              </div>
              {item.status === "failed" && item.error && (
                <p className="max-w-24 text-[11px] leading-tight font-semibold text-red-600 text-center">{item.error}</p>
              )}
              {item.status === "failed" && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => retry(item)} disabled={busy} className="min-h-11 px-2 text-xs font-bold text-primary hover:underline disabled:opacity-50">Try again</button>
                  <button type="button" onClick={() => dismiss(item)} className="min-h-11 px-2 text-xs font-bold text-muted-foreground hover:underline">Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirmingReplace && (
        <div role="group" aria-label={`Replace a receiving photo of ${cardLabel}`} className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-amber-900">
            Replace receiving photo {saved.indexOf(confirmingReplace) + 1}? The old photo comes off the card once the new one is saved. The customer&apos;s own photos are not changed.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => replaceWith("camera")} disabled={busy} className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}>
              <Camera className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Take new photo
            </button>
            <button type="button" onClick={() => replaceWith("library")} disabled={busy} className={`${btn} border border-border bg-white text-foreground hover:border-primary/50`}>
              Choose photo
            </button>
            <button type="button" onClick={() => setConfirmingReplace(null)} className={`${btn} text-muted-foreground hover:text-foreground`}>
              Keep the old photo
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          id={captureButtonId(cardId)}
          type="button"
          onClick={() => {
            replacing.current = null;
            setConfirmingReplace(null);
            cameraInput.current?.click();
          }}
          disabled={room === 0}
          className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`}
          aria-label={`Take photo of ${cardLabel}`}
        >
          <Camera className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Take photo
        </button>
        <button
          type="button"
          onClick={() => {
            replacing.current = null;
            setConfirmingReplace(null);
            libraryInput.current?.click();
          }}
          disabled={room === 0}
          className={`${btn} border border-border bg-white text-foreground hover:border-primary/50`}
          aria-label={`Choose photo of ${cardLabel}`}
        >
          Choose photo
        </button>
        {hasWebcam && (
          <button
            type="button"
            onClick={() => {
              // A Replace whose picker was dismissed must not turn this photo into a replacement
              replacing.current = null;
              setConfirmingReplace(null);
              setWebcamOpen(true);
            }}
            disabled={room === 0 || webcamOpen}
            className={`${btn} border border-border bg-white text-foreground hover:border-primary/50`}
            aria-label={`Use webcam for ${cardLabel}`}
          >
            Use webcam
          </button>
        )}
        {/* Phones and tablets open the rear camera; desktops get a file picker */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => onPicked(e, true)} />
        <input ref={libraryInput} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => onPicked(e, false)} />
      </div>
      {room === 0 && saved.length >= max && (
        <p className="text-xs text-muted-foreground">{max} receiving photos is the most a card can have. Replace or remove one to add another.</p>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}

      {webcamOpen && (
        <WebcamCapture
          cardLabel={cardLabel}
          onClose={() => setWebcamOpen(false)}
          onCapture={(file) => {
            setWebcamOpen(false);
            void handleFiles([file], true);
          }}
        />
      )}
    </div>
  );
}

/** Live webcam view with a Capture button: getUserMedia → canvas → JPEG. */
function WebcamCapture({ cardLabel, onClose, onCapture }: { cardLabel: string; onClose: () => void; onCapture: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  // One still per open webcam (a double click must not save two photos)
  const taken = useRef(false);
  const [state, setState] = useState<"starting" | "live" | "failed">("starting");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        setState("live");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : "";
        setFailure(
          name === "NotAllowedError" ? "The browser blocked the webcam. Allow camera access for this site, or use Choose photo instead."
            : name === "NotFoundError" || name === "OverconstrainedError" ? "No webcam was found. Use Choose photo instead."
            : "The webcam couldn't start. Use Choose photo instead.",
        );
        setState("failed");
      });
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, []);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth || taken.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailure("This browser can't take a still from the webcam. Use Choose photo instead.");
      setState("failed");
      return;
    }
    ctx.drawImage(v, 0, 0);
    taken.current = true;
    canvas.toBlob((blob) => {
      if (!blob) {
        taken.current = false;
        setFailure("The photo couldn't be made. Try again, or use Choose photo instead.");
        return;
      }
      onCapture(new File([blob], `webcam-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 flex flex-col gap-2" role="group" aria-label={`Webcam for ${cardLabel}`}>
      {state !== "failed" ? (
        <video ref={video} playsInline muted className="w-full max-w-md rounded-lg bg-black aspect-video object-contain" />
      ) : (
        <p role="alert" className="text-sm font-semibold text-red-600">{failure}</p>
      )}
      {state === "starting" && <p className="text-xs text-muted-foreground">Starting the webcam… allow camera access if the browser asks.</p>}
      {failure && state !== "failed" && <p role="alert" className="text-xs font-semibold text-red-600">{failure}</p>}
      <div className="flex flex-wrap gap-2">
        {state === "live" && (
          <button type="button" onClick={capture} className="min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90">
            Capture
          </button>
        )}
        <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/50">
          {state === "failed" ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

/**
 * A photo thumbnail that opens full size in a dialog on tap (staff stay on the
 * page). `thumb` is a smaller copy to show in the list, when there is one.
 */
export function EnlargeablePhoto({ url, thumb, alt, size = "sm", caption }: { url: string; thumb?: string; alt: string; size?: "sm" | "md"; caption?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const box = size === "md" ? "w-20 h-20" : "w-14 h-14";
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`${box} shrink-0 rounded-lg overflow-hidden border border-border bg-secondary/40 hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary`}
        aria-label={`Enlarge: ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb ?? url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </button>
      <dialog
        ref={dialog}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-auto max-w-[min(96vw,900px)] max-h-[92vh] p-0 rounded-xl bg-white backdrop:bg-black/70"
        aria-label={alt}
      >
        <div className="flex flex-col">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="max-h-[80vh] w-auto max-w-full object-contain bg-black" />
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-xs text-muted-foreground truncate">{caption ?? alt}</span>
            <div className="flex gap-1 shrink-0">
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-11 px-3 text-sm font-bold text-primary hover:underline">Open</a>
              <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 px-4 rounded-lg bg-gray-900 text-white text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
