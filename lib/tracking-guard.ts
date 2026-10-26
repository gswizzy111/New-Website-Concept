import { PIXEL_ID } from "@/lib/pixel";

/** Google Analytics 4 measurement ID. */
export const GA_ID = "G-LSQXS277DY";

/**
 * Stripe sends a restoration or prep buyer back to /checkout/success with the
 * checkout session ID in the address. The page reads it on the server, then
 * the script below takes it out of the address bar and keeps it here, for
 * that page only, so a reload still shows the order.
 */
export const CHECKOUT_SESSION_COOKIE = "checkout_session";

/** What a Stripe Checkout Session ID looks like (cs_test_..., cs_live_...). */
export const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{10,200}$/;

/**
 * The first script on every page (app/layout.tsx, in <head>). Google
 * Analytics and the Meta pixel record each page's full address and the
 * previous one, so no customer email, case link, sign-in or setup token, or
 * Stripe session ID may be in the address bar while they run. In order:
 *
 * 1. Return pages (/checkout/success, /shop/order-confirmed): the session ID
 *    is removed from the address with history.replaceState. The server has
 *    already rendered the page with it, and Next.js reads the cleaned address
 *    when it starts, so nothing after this line sees it.
 * 2. Private pages (staff areas, pages whose address is a key or holds an
 *    email, and any address with such a parameter) are never reported. If the
 *    page opens on one, neither tracker is loaded for the rest of the tab.
 * 3. history.pushState / replaceState and back/forward are watched from here
 *    on, before Next.js, Google or Meta hook them. Moving to a private page
 *    turns both trackers off for the rest of the tab, before the move happens:
 *    Google's own page-change tracking (it waits a second, then sends the new
 *    address and the previous one) is refused by its opt-out flag, and the
 *    pixel's consent is revoked. They stay off: turned on again, they would
 *    report the private page as the previous page.
 * 4. Only then are the trackers loaded (both scripts are added here, so they
 *    can't run first). Meta's own page views on navigation are switched off
 *    (disablePushState); components/meta-pixel-route-tracker.tsx sends them,
 *    and lib/pixel.ts sends nothing once tracking is off.
 *
 * Referrers: the site sends only its origin as the referrer (next.config.ts
 * and the root metadata), so a page opened from a private page in a new tab
 * doesn't carry that page's address either.
 */
export function trackingGuardScript(): string {
  return `(function () {
  var w = window, d = document, h = history, l = location;
  var KEY_PATH = new RegExp('^/(admin|accountant|account/(confirm|reset-password)|affiliates/setup|cases|email/unsubscribe|subscribe/manage|orders)(/|$)');
  var KEY_PARAM = /^(email|token|token_hash|session_id|uid|code)$/i;
  function isKey(url) {
    if (KEY_PATH.test(url.pathname)) return true;
    var key = false;
    url.searchParams.forEach(function (v, k) { if (KEY_PARAM.test(k)) key = true; });
    return key;
  }

  var here = new URL(l.href);
  if (here.pathname === '/checkout/success' || here.pathname === '/shop/order-confirmed') {
    var sid = here.searchParams.get('session_id');
    if (sid !== null) {
      if (here.pathname === '/checkout/success' && ${CHECKOUT_SESSION_ID}.test(sid)) {
        d.cookie = '${CHECKOUT_SESSION_COOKIE}=' + sid + '; path=/checkout/success; max-age=86400; samesite=lax' + (l.protocol === 'https:' ? '; secure' : '');
      }
      here.searchParams.delete('session_id');
      h.replaceState(h.state, '', here.pathname + here.search + here.hash);
    }
  }

  function stop() {
    w.__noTrack = true;
    w['ga-disable-${GA_ID}'] = true;
    if (typeof w.fbq === 'function') w.fbq('consent', 'revoke');
  }
  function check(url) {
    if (w.__noTrack) return;
    try { if (isKey(new URL(String(url), l.href))) stop(); } catch (e) {}
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var original = h[m];
    h[m] = function (state, unused, url) {
      if (url !== undefined && url !== null) check(url);
      return original.apply(h, arguments);
    };
  });
  w.addEventListener('popstate', function () { check(l.href); });

  if (isKey(new URL(l.href))) { stop(); return; }
  w.__noTrack = false;

  w.dataLayer = w.dataLayer || [];
  w.gtag = function () { w.dataLayer.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', '${GA_ID}');
  var ga = d.createElement('script');
  ga.async = true;
  ga.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_ID}';
  d.head.appendChild(ga);

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,
  d,'script','https://connect.facebook.net/en_US/fbevents.js');
  w.fbq.disablePushState = true;
  w.fbq('init', '${PIXEL_ID}');
  w.fbq('track', 'PageView');
})();`;
}
