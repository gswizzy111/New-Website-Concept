/**
 * Apps whose built-in browser can't pick photos or hand off payment reliably
 * (Instagram, Facebook, X/Twitter, TikTok). One test for the whole site.
 */
export const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|Twitter|TikTok/i;

/** True inside one of those in-app browsers; false on the server. */
export function isInAppBrowser(): boolean {
  return typeof navigator !== "undefined" && IN_APP_BROWSER.test(navigator.userAgent);
}
