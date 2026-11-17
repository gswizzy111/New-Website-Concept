import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { NotFoundPanel } from "@/components/marketing/not-found-panel";
import { PreviewBanner } from "@/components/marketing/preview-banner";
import { CartProvider } from "@/lib/cart-context";
import { cta } from "@/components/brand/button-class";

export const metadata = { title: "404 | The Card Doc" };

// Unmatched URLs render here, outside the (public) layout, so the page
// brings the same header and footer itself: a lost visitor keeps the full
// navigation, the Book button and the cart.
export default function NotFound() {
  return (
    <CartProvider>
      <a href="#main" className={cta({ tone: "sun", className: "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]" })}>
        Skip to content
      </a>
      <div className="nav-shell vt-header sticky top-0 z-50">
        <PreviewBanner />
        <Nav />
      </div>
      <main id="main" tabIndex={-1} className="flex flex-1 items-center bg-chalk outline-none">
        <NotFoundPanel />
      </main>
      <Footer />
    </CartProvider>
  );
}
