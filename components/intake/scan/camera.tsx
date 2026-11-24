"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Flashlight, FlashlightOff } from "lucide-react";

/**
 * The Scan page's camera: the phone's back camera, kept open, reading QR code
 * after code. Chrome on Android has a built-in reader (BarcodeDetector);
 * iPhone Safari doesn't, so there the frames go to jsQR (loaded only then).
 * Each frame only the part in and around the aim marks is read (so the label
 * next to the one aimed at is never taken), a few times a second. The
 * stream stops when the page is hidden (phone locked, another tab or app)
 * and starts again when it's back. `onRead` gets each QR's text; repeats are
 * the page's to ignore (parse.ts createScanGate).
 */

type Status = "off" | "starting" | "on" | "error";
type Detect = (video: HTMLVideoElement, view: { width: number; height: number }) => Promise<string[]>;
/** `mainThread`: jsQR, whose reads hold up the page (a slow phone then reads less often). */
type Reader = { detect: Detect; pause: number; mainThread: boolean };

type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string; boundingBox?: DOMRectReadOnly }[]> };
type BarcodeDetectorClass = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Largest side, in pixels, of the picture jsQR reads (bigger is slower). */
const DECODE_MAX = 640;
/** Pause between reads: the built-in reader is fast, jsQR runs on the main thread. */
const PAUSE_NATIVE_MS = 90;
const PAUSE_JS_MS = 140;
/** Remembered per browser: whether the camera was left on (so it starts again next time). */
const PREF_KEY = "scan.camera";
/** The aim marks drawn over the view: a square 62% of its height, at most 80% of its width, centred. */
const AIM_HEIGHT = 0.62;
const AIM_MAX_WIDTH = 0.8;
/** Codes are read inside the aim marks and a little around them, never at the edge of the view. */
const READ_MARGIN = 1.3;

type Region = { x: number; y: number; w: number; h: number };

/**
 * The part of the video frame that is read, in the frame's pixels: the
 * square around the aim marks (the view shows the frame centred with
 * object-fit: cover). Slot labels sit side by side (CLAMP 06, 07, 08): only
 * the one aimed at is read, never its neighbour at the edge of the picture.
 * It also keeps jsQR's work small on an older iPhone.
 */
function readRegion(vw: number, vh: number, view: { width: number; height: number }): Region {
  const scale = Math.max(view.width / vw, view.height / vh);
  const aim = Math.min(view.height * AIM_HEIGHT, view.width * AIM_MAX_WIDTH);
  const side = Math.min(view.width, view.height, aim * READ_MARGIN) / scale;
  const w = Math.max(1, Math.min(vw, Math.round(side)));
  const h = Math.max(1, Math.min(vh, Math.round(side)));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

let detectorPromise: Promise<Reader> | null = null;

/** The QR reader: BarcodeDetector when it reads QR codes, else jsQR. Made once per page load. */
function getDetector(): Promise<Reader> {
  detectorPromise ??= (async () => {
    const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
    if (BD) {
      try {
        const formats = (await BD.getSupportedFormats?.()) ?? [];
        if (formats.includes("qr_code")) {
          const detector = new BD({ formats: ["qr_code"] });
          // It finds every code in the frame: keep the one in the aim marks (the nearest the middle)
          const detect: Detect = async (video, view) => {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (!vw || !vh || !view.width || !view.height) return [];
            const r = readRegion(vw, vh, view);
            let best: { text: string; d: number } | null = null;
            for (const b of await detector.detect(video)) {
              if (!b.rawValue) continue;
              const box = b.boundingBox;
              const cx = box ? box.x + box.width / 2 : vw / 2;
              const cy = box ? box.y + box.height / 2 : vh / 2;
              if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) continue;
              const d = Math.hypot(cx - vw / 2, cy - vh / 2);
              if (!best || d < best.d) best = { text: b.rawValue, d };
            }
            return best ? [best.text] : [];
          };
          return { detect, pause: PAUSE_NATIVE_MS, mainThread: false };
        }
      } catch {
        // fall back to jsQR
      }
    }
    const mod = (await import("jsqr")) as unknown as { default?: JsQr } & JsQr;
    const jsQR: JsQr = typeof mod.default === "function" ? mod.default : mod;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser can't read QR codes from the camera.");
    const detect: Detect = async (video, view) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || !view.width || !view.height) return [];
      // Only the square around the aim marks (jsQR reads one code per picture)
      const r = readRegion(vw, vh, view);
      const k = Math.min(1, DECODE_MAX / Math.max(r.w, r.h));
      const w = Math.max(1, Math.round(r.w * k));
      const h = Math.max(1, Math.round(r.h * k));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, w, h);
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      return found?.data ? [found.data] : [];
    };
    return { detect, pause: PAUSE_JS_MS, mainThread: true };
  })();
  detectorPromise.catch(() => {
    detectorPromise = null;
  });
  return detectorPromise;
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked for this site. Allow it (iPhone: Settings → Apps → Safari → Camera, or the aA menu → Website Settings), then tap Start camera. A handheld scanner or typing the code works meanwhile.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "No camera found. Use a handheld scanner or type the code below.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "The camera is busy (another app or tab may be using it). Close it, then tap Start camera.";
  }
  return "The camera didn't start. Tap Start camera to try again, or type the code below.";
}

function readPref(): "on" | "off" | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

function writePref(v: "on" | "off") {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    // private mode: not remembered
  }
}

/** What the camera can do; torch and focusMode aren't in every browser's types. */
type CameraCaps = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };

/** `compact`: a shorter view on a phone while a slot or bag is on screen (the view stays the same on a computer). */
export function ScanCamera({ onRead, label, compact = false }: { onRead: (text: string) => void; label?: string; compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Each start gets a number; a start or loop from before a stop sees a newer one and quits
  const runRef = useRef(0);
  const resumeOnShowRef = useRef(false);
  const onReadRef = useRef(onRead);
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState("");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  const release = useCallback(() => {
    runRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setTorch({ available: false, on: false });
  }, []);

  const loop = useCallback(async (run: number) => {
    let reader: Reader;
    try {
      reader = await getDetector();
    } catch (e) {
      if (runRef.current !== run) return;
      setError(e instanceof Error ? e.message : "This browser can't read QR codes from the camera.");
      setStatus("error");
      return;
    }
    while (runRef.current === run) {
      // Waits for the next frame on screen (and stops reading while the page is hidden)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (runRef.current !== run) return;
      const video = videoRef.current;
      const box = boxRef.current;
      let took = 0;
      if (video && box && video.readyState >= 2) {
        const t0 = performance.now();
        try {
          const texts = await reader.detect(video, { width: box.clientWidth, height: box.clientHeight });
          if (runRef.current !== run) return;
          for (const text of texts) onReadRef.current(text);
        } catch {
          // a frame that couldn't be read: try the next one
        }
        took = performance.now() - t0;
      }
      // jsQR on a slow phone: rest at least twice as long as the read took, so taps stay quick
      const pause = reader.mainThread ? Math.min(1000, Math.max(reader.pause, took * 2)) : reader.pause;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }, []);

  const start = useCallback(async () => {
    release();
    const run = runRef.current;
    setError("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        typeof window !== "undefined" && !window.isSecureContext
          ? "The camera only works on the https:// address of the site. A handheld scanner or typing the code works here."
          : "This browser has no camera access. Use a handheld scanner or type the code below.",
      );
      setStatus("error");
      return;
    }
    setStatus("starting");
    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw e;
        }
      }
    } catch (e) {
      if (runRef.current !== run) return;
      setError(cameraError(e));
      setStatus("error");
      return;
    }
    // Stopped (or started again) while the phone was asking for permission
    if (runRef.current !== run) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    writePref("on");
    // The page went away while the camera was starting (phone locked, another app): let go until it's back
    if (document.visibilityState === "hidden") {
      resumeOnShowRef.current = true;
      release();
      setStatus("off");
      return;
    }
    const track = stream.getVideoTracks()[0] as MediaStreamTrack | undefined;
    let caps: CameraCaps | undefined;
    try {
      caps = track?.getCapabilities?.() as CameraCaps | undefined;
    } catch {
      // older browsers: no torch button
    }
    setTorch({ available: !!caps?.torch, on: false });
    if (track && caps?.focusMode?.includes("continuous")) {
      track.applyConstraints({ advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet] }).catch(() => {});
    }
    // The stream ends by itself if the camera is taken away (another app, unplugged)
    track?.addEventListener("ended", () => {
      if (runRef.current !== run) return;
      release();
      setStatus("off");
    });
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // muted + playsInline autoplays; a refused play() still shows frames once allowed
      }
    }
    if (runRef.current !== run) return;
    setStatus("on");
    void loop(run);
  }, [loop, release]);

  const stop = useCallback(() => {
    release();
    resumeOnShowRef.current = false;
    writePref("off");
    setStatus("off");
    setError("");
  }, [release]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch({ available: false, on: false });
    }
  }

  // Start by itself when it was left on last time, or on a phone the first time
  // (just after the first paint, so the page shows at once)
  useEffect(() => {
    const pref = readPref();
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const timer = setTimeout(() => {
      if (pref === "on" || (pref === null && touch)) void start();
    }, 0);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [start, release]);

  // Phone locked, another tab or app: let go of the camera; back: start again
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (streamRef.current) {
          resumeOnShowRef.current = true;
          release();
          setStatus("off");
        }
      } else if (resumeOnShowRef.current) {
        resumeOnShowRef.current = false;
        void start();
      }
    }
    function onPageHide() {
      if (streamRef.current) resumeOnShowRef.current = true;
      release();
      setStatus("off");
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [release, start]);

  const on = status === "on";
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={boxRef}
        className={`relative w-full overflow-hidden rounded-2xl bg-gray-900 lg:h-[min(52vh,440px)] ${compact ? "h-[min(26vh,220px)]" : "h-[min(40vh,340px)]"}`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label={label ?? "Camera view for scanning QR codes"}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`}
        />
        {/* Aim here: corner marks over the middle of the view (sized as AIM_HEIGHT / AIM_MAX_WIDTH: codes are read only around them) */}
        {on && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[62%] aspect-square max-w-[80%]">
              <span className="absolute left-0 top-0 h-7 w-7 border-l-4 border-t-4 border-white/90 rounded-tl-lg" />
              <span className="absolute right-0 top-0 h-7 w-7 border-r-4 border-t-4 border-white/90 rounded-tr-lg" />
              <span className="absolute left-0 bottom-0 h-7 w-7 border-l-4 border-b-4 border-white/90 rounded-bl-lg" />
              <span className="absolute right-0 bottom-0 h-7 w-7 border-r-4 border-b-4 border-white/90 rounded-br-lg" />
            </div>
          </div>
        )}
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center">
            {status === "error" ? (
              <p role="alert" className="max-w-sm text-sm font-semibold leading-snug text-white">{error}</p>
            ) : status === "starting" ? (
              <p role="status" className="text-sm font-semibold text-white/80">Starting the camera…</p>
            ) : (
              <p className="text-sm font-semibold text-white/80">Camera is off.</p>
            )}
            {status !== "starting" && (
              <button
                type="button"
                onClick={() => void start()}
                className="min-h-12 px-6 rounded-full bg-white text-gray-900 text-base font-black inline-flex items-center gap-2 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
              >
                <Camera className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                Start camera
              </button>
            )}
          </div>
        )}
        {on && (
          <div className="absolute bottom-2 right-2 flex gap-2">
            {torch.available && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-pressed={torch.on}
                aria-label="Light"
                className="h-11 w-11 rounded-full bg-black/55 text-white inline-flex items-center justify-center hover:bg-black/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
              >
                {torch.on ? <FlashlightOff className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /> : <Flashlight className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
              </button>
            )}
            <button
              type="button"
              onClick={stop}
              aria-label="Stop camera"
              className="h-11 w-11 rounded-full bg-black/55 text-white inline-flex items-center justify-center hover:bg-black/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
            >
              <CameraOff className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
