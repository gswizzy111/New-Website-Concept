/**
 * The Scan page's beeps and buzzes: WebAudio tones (no sound files) and
 * navigator.vibrate where the phone has it (Android; iPhones don't). Browsers
 * only play sound after a tap or key press on the page, so unlockAudio() runs
 * on the first one. iPhones also mute web sounds when the ring switch is on
 * silent: the big ✓ / ⚠ on screen is the feedback that always shows.
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;

function audio(): Ctx | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // "suspended" until a tap; "interrupted" (iPhone) after a call or the lock screen
    if (ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Whether beeps can play now (a tap or key press has unlocked the sound). */
export function audioUnlocked(): boolean {
  return ctx?.state === "running";
}

/** Call from a tap or key press: lets later beeps play. */
export function unlockAudio() {
  const c = audio();
  if (!c) return;
  // A silent blip: iOS Safari only "unlocks" once something has played in a gesture
  try {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(c.destination);
    const o = c.createOscillator();
    o.connect(g);
    o.start();
    o.stop(c.currentTime + 0.01);
  } catch {
    // no sound, the screen still shows the result
  }
}

function tone(c: Ctx, freq: number, start: number, duration: number, type: OscillatorType, volume: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  // Short fades in and out, so the beep doesn't click
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  g.gain.setValueAtTime(volume, start + duration - 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  o.connect(g);
  g.connect(c.destination);
  o.start(start);
  o.stop(start + duration + 0.02);
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}

export type Beep = "read" | "pending" | "ok" | "error";

/**
 * "read": a code was read (one short high beep, a tap of vibration).
 * "pending": a move or Done waits for the same label again (two equal mid
 * beeps: "again"). "ok": saved, moved (two quick rising notes). "error": not
 * a code, not found, refused or not saved (two low buzzes, a long double
 * vibration).
 */
export function beep(kind: Beep, sound = true) {
  if (kind === "error") vibrate([120, 60, 120]);
  else if (kind === "pending") vibrate([40, 80, 40]);
  else vibrate(kind === "read" ? 35 : 20);
  if (!sound) return;
  const c = audio();
  if (!c) return;
  try {
    const t = c.currentTime + 0.01;
    if (kind === "read") tone(c, 1760, t, 0.07, "sine", 0.25);
    else if (kind === "pending") {
      tone(c, 988, t, 0.09, "triangle", 0.22);
      tone(c, 988, t + 0.16, 0.09, "triangle", 0.22);
    }
    else if (kind === "ok") {
      tone(c, 1320, t, 0.06, "sine", 0.2);
      tone(c, 1760, t + 0.07, 0.08, "sine", 0.2);
    } else {
      tone(c, 220, t, 0.14, "square", 0.12);
      tone(c, 180, t + 0.2, 0.18, "square", 0.12);
    }
  } catch {
    // no sound, the screen still shows the result
  }
}
