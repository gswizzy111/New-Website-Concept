import { cta } from "@/components/brand/button-class";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { CartProvider } from "@/lib/cart-context";
import { PreviewBanner } from "@/components/marketing/preview-banner";
import { RevealObserver } from "@/components/motion/reveal-observer";
import { SpotlightTracker } from "@/components/motion/spotlight-tracker";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <a href="#main" className={cta({ tone: "sun", className: "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]" })}>
        Skip to content
      </a>
      <div className="nav-shell vt-header sticky top-0 z-50">
        <PreviewBanner />
        <Nav />
      </div>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <Footer />
      <RevealObserver />
      <SpotlightTracker />
    </CartProvider>
  );
}
