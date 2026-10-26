import { PIXEL_ID } from "@/lib/pixel";

/** Google Analytics 4 measurement ID. */
export const GA_ID = "G-LSQXS277DY";

/**
 * Stripe sends a restoration buyer back to /checkout/success with the
 * checkout session ID in the address. The page reads it on the server, then
 * the script below takes it out of the address bar and keeps it here, for
 * that page only, so a reload still shows the order.
 */
export const CHECKOUT_SESSION_COOKIE = "checkout_session";

/**
 * Pages Stripe returns buyers to with ?session_id= (restoration and prep,
 * kits, and gift cards and Kit Club once their checkouts add it). Each reads
 * the ID on the server, for the order and the Meta Purchase event, and the
 * script below takes it out of the address.
 */
export const RETURN_PAGE = /^\/(checkout\/success|shop\/order-confirmed|gift-cards\/success|subscribe\/success)$/;

/** What a Stripe Checkout Session ID looks like (cs_test_..., cs_live_...). */
export const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{10,200}$/;

/**
 * The first script on every page (app/layout.tsx, in <head>). Google
 * Analytics and the Meta pixel record each page's full address and the
 * previous one, so no customer email, case link, sign-in or setup token, or
 * Stripe session ID may be in the address bar while they run. In order:
 *
 * 0. Global Privacy Control: window.__gpc is set from the browser's signal.
 *    When it is on, the Meta pixel is never loaded (fbevents.js is never
 *    requested), as the privacy policy says. Google Analytics doesn't depend
 *    on it.
 * 1. Stripe return pages (RETURN_PAGE): the session ID is removed from the
 *    address with history.replaceState. The server has already rendered the
 *    page with it, and Next.js reads the cleaned address when it starts (its
 *    router takes window.location as the first URL), so nothing after this
 *    line sees it.
 * 2. Private pages (staff areas, pages whose address is a key or holds an
 *    email, and any address with such a parameter or an email in it) are
 *    never reported. If the page opens on one, neither tracker is loaded for
 *    the rest of the tab.
 * 3. history.pushState / replaceState and back/forward are watched from here
 *    on, before Next.js, Google or Meta hook them (they wrap this wrapper, so
 *    it runs first). Moving to a private page turns both trackers off for the
 *    rest of the tab, before the move happens: Google's own page-change
 *    tracking (it sends the new address and the previous one) is refused by
 *    its opt-out flag, and the pixel's consent is revoked. They stay off:
 *    turned on again, they would report the private page as the previous page.
 * 4. Only then are the trackers loaded (both scripts are added here, so they
 *    can't run first). Meta's own page views on navigation are switched off
 *    (disablePushState); components/meta-pixel-route-tracker.tsx sends them,
 *    and lib/pixel.ts sends nothing once tracking is off or when the pixel
 *    isn't loaded. The pixel's automatic configuration (button clicks with
 *    the link they go to, page metadata) is off, so a link holding an email
 *    or a label address is never sent either.
 *
 * Referrers: the site sends only its origin as the referrer (next.config.ts
 * and the root metadata), so a page opened from a private page by a full
 * page load doesn't carry that page's address either.
 */
export function trackingGuardScript(): string {
  return `(function () {
  var w = window, d = document, h = history, l = location;
  w.__gpc = navigator.globalPrivacyControl === true;

  var KEY_PATH = new RegExp('^/(admin|accountant|account/(confirm|reset-password)|affiliates/setup|cases|email/unsubscribe|subscribe/manage|orders)(/|$)');
  var KEY_PARAM = /^(email|token|token_hash|access_token|refresh_token|session_id|uid|code)$/i;
  function keyParams(params) {
    var key = false;
    params.forEach(function (v, k) { if (KEY_PARAM.test(k) || v.indexOf('@') !== -1) key = true; });
    return key;
  }
  function isKey(url) {
    if (KEY_PATH.test(url.pathname) || /@|%40/.test(url.pathname)) return true;
    return keyParams(url.searchParams) || (url.hash.length > 1 && keyParams(new URLSearchParams(url.hash.slice(1))));
  }

  var here = new URL(l.href);
  if (${RETURN_PAGE}.test(here.pathname)) {
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
    if (typeof w.fbq === 'function') {
      // fbevents.js not loaded yet: drop the queued init and page view, which
      // it would otherwise send with the new address before the revoke
      if (!w.fbq.callMethod && Array.isArray(w.fbq.queue)) w.fbq.queue.length = 0;
      w.fbq('consent', 'revoke');
    }
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

  if (w.__gpc) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,
  d,'script','https://connect.facebook.net/en_US/fbevents.js');
  w.fbq.disablePushState = true;
  w.fbq('set', 'autoConfig', false, '${PIXEL_ID}');
  w.fbq('init', '${PIXEL_ID}');
  w.fbq('track', 'PageView');
})();`;
}
