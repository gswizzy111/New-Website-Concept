declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fbq: (...args: any[]) => void;
    _fbq: unknown;
    /** True on a page that must not be reported, and for the rest of the tab
     * after one (set by the first script on every page, lib/tracking-guard.ts). */
    __noTrack?: boolean;
    /** The browser sends Global Privacy Control: the pixel is never loaded
     * (set by the same script). */
    __gpc?: boolean;
  }
}

export const PIXEL_ID = "2149575685996056";

// Safe wrapper: no-ops if the pixel isn't loaded (Global Privacy Control
// is on, or the page is private), or while tracking is off (a private page
// was opened in this tab; see lib/tracking-guard.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fbq(...args: any[]) {
  if (
    typeof window !== "undefined" &&
    window.__gpc !== true &&
    window.__noTrack !== true &&
    typeof window.fbq === "function"
  ) {
    window.fbq(...args);
  }
}
