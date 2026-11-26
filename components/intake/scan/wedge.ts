/**
 * The keyboard wedge's rules (pure; safe in tests): scan-input.tsx
 * useKeyboardWedge runs them on every key press anywhere on the Scan page.
 * A handheld scanner in keyboard mode (the Eyoyo paired with the phone over
 * Bluetooth) types a label's text a few milliseconds per character and ends
 * with Enter (or Tab); over Bluetooth the keys can bunch up and stall.
 *
 *  - Characters within KEY_GAP_MS (300 ms) of the one before belong to one
 *    scan; a longer pause starts a new one (so a stray key pressed minutes
 *    ago never ends up in front of a scan).
 *  - Enter or Tab within ENTER_GAP_MS (1 s) of the last character sends the
 *    scan when it has MIN_LENGTH (4) or more characters; that Enter never
 *    reaches the focused element.
 *  - Enter or Tab within ENTER_GAP_MS of ANY character is kept from the
 *    focused element even when it isn't a scan (a broken read: fewer than 4
 *    characters got through before the scanner's Enter), so a broken scan
 *    can never press a focused button. A lone Space (a person pressing a
 *    button or tick box with the keyboard, then Tab or Enter) doesn't count.
 *  - From a scan's second character on, its keys are kept from the focused
 *    element (a button or link never reacts); on a focused <select> every
 *    character is (its type-ahead would change the choice).
 *  - A second Enter or Tab right after a scan's (a scanner set to end with
 *    CR LF, or Enter and Tab) is kept from the focused element too.
 *  - Other keys (Shift, arrows, Escape) are left alone and don't break a scan.
 */

export const KEY_GAP_MS = 300;
export const ENTER_GAP_MS = 1000;
export const MIN_LENGTH = 4;
/** How soon after a scan's Enter a second end key counts as part of it. */
export const SUFFIX_MS = 150;

export type WedgeState = { buffer: string; last: number; scannedAt: number };
/** `scan`: the text to send (null: none); `block`: keep the key from the focused element. */
export type WedgeResult = { scan: string | null; block: boolean };

export function newWedge(): WedgeState {
  return { buffer: "", last: -Infinity, scannedAt: -Infinity };
}

/** One key press at `at` ms (the event's timeStamp). `select`: a <select> has focus. */
export function wedgeKey(state: WedgeState, key: string, at: number, { select = false }: { select?: boolean } = {}): WedgeResult {
  if (key === "Enter" || key === "Tab") {
    const text = state.buffer;
    const fresh = at - state.last <= ENTER_GAP_MS;
    state.buffer = "";
    state.last = -Infinity;
    if (fresh && text.length >= MIN_LENGTH) {
      state.scannedAt = at;
      return { scan: text, block: true };
    }
    // A broken scan's end key (too short, or an Enter after a stray key) is kept from the focused element too
    const broken = fresh && text.trim() !== "";
    return { scan: null, block: broken || at - state.scannedAt <= SUFFIX_MS };
  }
  if (key.length !== 1) return { scan: null, block: false };
  if (at - state.last > KEY_GAP_MS) state.buffer = "";
  state.buffer = (state.buffer + key).slice(-300);
  state.last = at;
  return { scan: null, block: select || state.buffer.length > 1 };
}
