/**
 * Apps whose built-in browser can't pick photos or hand off payment reliably
 * (Instagram, Facebook, X/Twitter, TikTok). One test for the whole site.
 * TikTok's in-app browser doesn't say "TikTok": it reports musical_ly,
 * BytedanceWebview or Trill.
 */
export const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|Twitter|TikTok|musical_ly|BytedanceWebview|Trill_/i;

/** True inside one of those in-app browsers; false on the server. */
export function isInAppBrowser(): boolean {
  return typeof navigator !== "undefined" && IN_APP_BROWSER.test(navigator.userAgent);
}
