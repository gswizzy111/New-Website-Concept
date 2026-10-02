import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { CountdownTicker } from "@/components/marketing/countdown-ticker";
import { RestorationBubble } from "@/components/marketing/restoration-bubble";
import { CartProvider } from "@/lib/cart-context";
import { PreviewBanner } from "@/components/marketing/preview-banner";
import { RevealObserver } from "@/components/motion/reveal-observer";
import { SpotlightTracker } from "@/components/motion/spotlight-tracker";
import { SmoothScroll } from "@/components/motion/smooth-scroll";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="nav-shell vt-header sticky top-0 z-50">
        <PreviewBanner />
        <Nav />
        <CountdownTicker />
      </div>
      <main className="flex-1">{children}</main>
      <Footer />
      <RestorationBubble />
      <RevealObserver />
      <SpotlightTracker />
      <SmoothScroll />
      <div aria-hidden className="grain-overlay vt-grain" />
    </CartProvider>
  );
}
