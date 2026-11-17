"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Camera, ImageOff, Images, LoaderCircle, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_CARD_PHOTOS } from "@/lib/site-config";
import { isInAppBrowser as inAppBrowser } from "@/lib/in-app-browser";
import { trackCheckout, type CheckoutFlow } from "@/lib/checkout-funnel";
import { cta } from "@/components/brand/button-class";

/** Keys for photos still uploading (unique for the page; no crypto.randomUUID needed). */
let photoSeq = 0;

interface PhotoUploaderProps {
  photoUrls: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  /** The checkout the photos belong to, for the funnel count; null counts nothing. */
  flow?: CheckoutFlow | null;
}

// Compress image client-side to ≤ 2000px wide, JPEG 0.85.
// Keeps files small (< 1 MB typically) so uploads are fast and well under any size cap.
// Falls back to original file if canvas fails (e.g. unsupported format on some desktops).
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const MAX_PX = 2000;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > MAX_PX) {
        height = Math.round((height * MAX_PX) / width);
        width = MAX_PX;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // can't decode (e.g. HEIC on desktop) — send original
    };
    img.src = objectUrl;
  });
}

// The file's type, or a guess from its name when the browser gives none (many
// desktops don't know HEIC). The bucket only takes uploads declared as images.
function fileType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : "";
}

async function uploadFile(file: File): Promise<string> {
  // Compress first; if compression produces a tiny result, upload directly.
  const compressed = await compressImage(file);
  const contentType = fileType(compressed);

  // Try presigned direct-to-Supabase upload first (bypasses Netlify 6 MB body cap).
  // Fall back to regular server-side POST if presign fails.
  try {
    const presignRes = await fetch("/api/upload", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: compressed.name, contentType }),
    });
    if (presignRes.ok) {
      const { signedUrl, publicUrl } = await presignRes.json();
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: compressed,
      });
      if (uploadRes.ok) return publicUrl as string;
    }
  } catch {
    // fall through to server-side POST
  }

  // Server-side POST fallback (compressed file is typically < 500 KB, well under limits)
  const fd = new FormData();
  fd.append("file", compressed);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw Object.assign(new Error(d.error ?? `Upload failed (${res.status})`), { status: res.status });
  }
  const data = await res.json();
  if (!data.url) throw new Error(data.error ?? "Upload failed");
  return data.url as string;
}

// The user agent never changes while the page is open
const noSubscribe = () => () => {};

/** One photo on its way up: a placeholder while it uploads, a "Try again" row if it fails. */
interface PendingPhoto {
  key: string;
  file: File;
  /** A local preview (object URL); empty when the browser can't make one */
  preview: string;
  status: "uploading" | "failed";
  error?: string;
}

/** A short code for the funnel count: the HTTP status, or "network". */
function failureCode(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `http_${status}`;
  return err instanceof TypeError ? "network" : "upload_failed";
}

export function PhotoUploader({ photoUrls, onChange, max = MAX_CARD_PHOTOS, flow = "restoration" }: PhotoUploaderProps) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Read out by screen readers as photos start, finish or fail
  const [announcement, setAnnouncement] = useState("");
  // In-app browsers (Instagram, Facebook...) often can't pick photos; false on the server
  const isInAppBrowser = useSyncExternalStore(noSubscribe, inAppBrowser, () => false);

  // The latest photos and onChange, so photos finishing one after another all land
  const urlsRef = useRef(photoUrls);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    urlsRef.current = photoUrls;
    onChangeRef.current = onChange;
  });
  // One upload at a time (each is compressed in memory first), each with its own result
  const queue = useRef<Promise<void>>(Promise.resolve());
  const previews = useRef(new Map<string, string>());
  useEffect(() => {
    const map = previews.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  function commit(urls: string[]) {
    urlsRef.current = urls;
    onChangeRef.current(urls);
  }

  function dropPending(key: string) {
    const preview = previews.current.get(key);
    if (preview) URL.revokeObjectURL(preview);
    previews.current.delete(key);
    setPending((list) => list.filter((p) => p.key !== key));
  }

  function upload(key: string, file: File) {
    queue.current = queue.current.then(async () => {
      try {
        const url = await uploadFile(file);
        commit([...urlsRef.current, url]);
        dropPending(key);
        setAnnouncement(`Photo uploaded. ${urlsRef.current.length} of ${max}.`);
        if (flow) trackCheckout(flow, "photo_added");
      } catch (err) {
        const msg = err instanceof TypeError
          ? "Check your connection and try again."
          : err instanceof Error ? err.message : "Upload failed. Please try again.";
        setPending((list) => list.map((p) => (p.key === key ? { ...p, status: "failed", error: msg } : p)));
        setAnnouncement(`A photo didn't upload. ${msg}`);
        toast.error(msg);
        if (flow) trackCheckout(flow, "photo_failed", { code: failureCode(err) });
      }
    });
  }

  function processFiles(rawFiles: File[]) {
    setUploadError("");
    // Photos still uploading or waiting to be tried again hold their place
    const remaining = max - urlsRef.current.length - pending.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${max} photos per card.`);
      return;
    }
    const toUpload = rawFiles.filter((f) => !f.type || f.type.startsWith("image/")).slice(0, remaining);
    if (toUpload.length === 0) {
      const msg = "Please select image files (JPEG, PNG, HEIC, etc.)";
      setUploadError(msg);
      toast.error(msg);
      return;
    }

    const items: PendingPhoto[] = toUpload.map((file) => {
      const key = `photo-${++photoSeq}`;
      let preview = "";
      try {
        preview = URL.createObjectURL(file);
        previews.current.set(key, preview);
      } catch {
        // No preview: the placeholder shows without one
      }
      return { key, file, preview, status: "uploading" };
    });
    setPending((list) => [...list, ...items]);
    setAnnouncement(items.length === 1 ? "Uploading photo…" : `Uploading ${items.length} photos…`);
    for (const item of items) upload(item.key, item.file);
  }

  function retry(item: PendingPhoto) {
    setPending((list) => list.map((p) => (p.key === item.key ? { ...p, status: "uploading", error: undefined } : p)));
    setAnnouncement("Uploading photo…");
    upload(item.key, item.file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Cleared first, so the same photo can be picked again
    e.target.value = "";
    processFiles(files);
  }

  const canAddMore = photoUrls.length + pending.length < max;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (canAddMore) processFiles(Array.from(e.dataTransfer.files));
  }

  function remove(url: string) {
    commit(urlsRef.current.filter((u) => u !== url));
  }

  if (isInAppBrowser) {
    return (
      <div className="rounded-[14px] bg-red-50 p-4 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]">
        <p className="mb-1 flex items-center gap-2 font-semibold text-destructive"><ImageOff className="h-4 w-4 shrink-0" strokeWidth={2} />Photo upload blocked</p>
        <p className="text-destructive leading-relaxed">
          Instagram&apos;s browser doesn&apos;t allow photo uploads.{" "}
          <strong>Tap ··· → &quot;Open in browser&quot;</strong> to use Safari or Chrome, then come back to this page.
        </p>
      </div>
    );
  }

  const heading = photoUrls.length === 0 ? "Upload photos of your card" : "Add more photos";
  const counter = (
    <p className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-ink-soft tabular-nums shadow-[0_0_0_1px_var(--line)]">
      {photoUrls.length}/{max} photo{max !== 1 ? "s" : ""}
    </p>
  );
  const uploading = pending.filter((p) => p.status === "uploading");
  const failed = pending.filter((p) => p.status === "failed");

  return (
    <div className="flex flex-col gap-4">
      {/* The exam tray: the photos, and each one still uploading */}
      {(photoUrls.length > 0 || uploading.length > 0) && (
        <div className="flex flex-wrap gap-4 pt-2 pr-2">
          {photoUrls.map((url) => (
            <div key={url} className="group relative size-24 shrink-0 rounded-[8px] bg-white p-1.5 shadow-[var(--print-shadow)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full rounded-[3px] object-cover" />
              <button
                type="button"
                onClick={() => remove(url)}
                className="absolute -top-3 -right-3 grid size-9 place-items-center rounded-full bg-ink text-white shadow-[0_0_0_2px_var(--white)] transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-destructive focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-cobalt"
                aria-label="Remove photo"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {uploading.map((p) => (
            <div key={p.key} className="relative size-24 shrink-0 overflow-hidden rounded-[8px] bg-white p-1.5 shadow-[var(--print-shadow)]">
              {p.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.preview}
                  alt=""
                  className="h-full w-full rounded-[3px] object-cover opacity-40"
                  // Some formats (HEIC on most desktops) can't be previewed
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                <LoaderCircle aria-hidden className="size-6 animate-spin text-cobalt motion-reduce:animate-none" strokeWidth={2} />
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-ink">Uploading…</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Each photo that didn't upload, with its own Try again */}
      {failed.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {failed.map((p) => (
            <li key={p.key} className="flex items-start gap-3 rounded-[14px] bg-red-50 p-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]">
              <span aria-hidden className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-white text-destructive shadow-[0_0_0_1px_var(--line)]">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                ) : (
                  <ImageOff className="size-5" strokeWidth={1.75} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p id={`${p.key}-msg`} className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <AlertTriangle aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
                  Photo didn&apos;t upload
                </p>
                <p className="mt-0.5 break-words text-xs text-destructive">{p.error}</p>
                <button
                  type="button"
                  onClick={() => retry(p)}
                  aria-describedby={`${p.key}-msg`}
                  className={cta({ tone: "outline", size: "sm", className: "mt-2.5" })}
                >
                  <RotateCcw aria-hidden className="size-4" strokeWidth={1.75} />
                  Try again
                </button>
              </div>
              <button
                type="button"
                onClick={() => dropPending(p.key)}
                className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-destructive hover:bg-white focus-visible:outline-3 focus-visible:outline-cobalt"
                aria-label="Remove photo"
              >
                <X className="size-4" strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Phones and tablets: the camera first, then the photo library */}
      {canAddMore && (
        <div className="hidden flex-col gap-3 rounded-[18px] border-2 border-dashed border-ink/25 bg-chalk p-4 pointer-coarse:flex">
          <div className="flex items-start justify-between gap-3">
            <p className="font-heading text-[1.35rem] leading-tight font-extrabold text-ink">{heading}</p>
            {counter}
          </div>
          {/* Side by side only when both fit (the labels don't wrap), else stacked */}
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={() => cameraRef.current?.click()} className={cta({ tone: "cobalt", className: "w-full min-[480px]:w-auto min-[480px]:flex-1" })}>
              <Camera aria-hidden className="size-5" strokeWidth={1.75} />
              Take photo
            </button>
            <button type="button" onClick={() => libraryRef.current?.click()} className={cta({ tone: "outline", className: "w-full min-[480px]:w-auto min-[480px]:flex-1" })}>
              <Images aria-hidden className="size-5" strokeWidth={1.75} />
              Choose from library
            </button>
          </div>
        </div>
      )}

      {/* Mouse and trackpad: drag and drop, or click to choose */}
      {canAddMore && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload photos"
          onClick={() => libraryRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); libraryRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative flex cursor-pointer select-none flex-col items-center justify-center gap-3 rounded-[18px] border-2 border-dashed px-4 py-8 transition-[background-color,border-color] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt motion-reduce:transition-none pointer-coarse:hidden
            ${dragOver ? "border-cobalt bg-cobalt-wash" : "border-ink/25 bg-chalk hover:border-cobalt hover:bg-cobalt-wash"}
          `}
        >
          <span aria-hidden className="grid size-14 place-items-center rounded-full bg-white text-cobalt shadow-[0_0_0_1px_var(--line),0_6px_14px_-8px_rgba(8,12,40,0.4)]">
            <Camera className="size-6" strokeWidth={1.75} />
          </span>
          <div className="text-center">
            <p className="font-heading text-[1.35rem] leading-tight font-extrabold text-ink">{heading}</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              Tap to choose · Drag &amp; drop · Any photo format · Large files OK
            </p>
          </div>
          {counter}
        </div>
      )}

      {/* Inline error banner */}
      {uploadError && (
        <div className="flex items-start gap-2 rounded-[14px] bg-red-50 px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" strokeWidth={2.25} />
          <p className="text-xs text-destructive font-medium flex-1">{uploadError}</p>
          <button
            type="button"
            onClick={() => setUploadError("")}
            className="-my-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-destructive hover:bg-white"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {/* Hidden file inputs — accept ANY image (JPEG, PNG, WEBP, HEIC, etc.).
          The camera one opens the back camera on phones. */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Upload card photos"
        className="hidden"
        onChange={handleInputChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo of your card"
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}
