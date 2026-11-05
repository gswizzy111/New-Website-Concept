import type { Metadata, Viewport } from "next";
import { Poppins, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelRouteTracker } from "@/components/meta-pixel-route-tracker";
import { trackingGuardScript } from "@/lib/tracking-guard";
import { siteUrl } from "@/lib/site-url";
import { JsonLd } from "@/components/seo/json-ld";
import { ORGANIZATION } from "@/lib/seo";

const poppins = Poppins({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

// Body, UI, labels and figures: a newspaper grotesque with tabular numerals.
const schibsted = Schibsted_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  // Matches the paper header at the top of every page.
  themeColor: "#f7efe1",
};

export const metadata: Metadata = {
  // Makes the share image's URL absolute; without it previews pointed at localhost
  metadataBase: new URL(siteUrl()),
  // Links and requests from these pages pass on only the site's origin, never
  // a page's address (which can hold an email or a one-time link). Also sent
  // as a header (next.config.ts).
  referrer: "strict-origin",
  title: "The Card Doc — Card Cleaning Kits & Restoration",
  description:
    "Professional card cleaning kits and PSA prep restoration service for trading card collectors.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "The Card Doc — Card Cleaning Kits & Restoration",
    description: "Professional card cleaning kits and PSA prep restoration service for trading card collectors.",
    images: [{ url: "/og-image.png", width: 1080, height: 1080 }],
  },
  twitter: {
    card: "summary",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${schibsted.variable} h-full antialiased`}>
      <head>
        <meta name="facebook-domain-verification" content="ihjnpqbitwq29e5kx3x0dujilxh1n9" />
        {/* Runs before anything else on the page and loads Google Analytics
            and the Meta pixel itself, after taking Stripe session IDs out of
            the address and only on pages that may be reported: no email,
            case link, one-time token or session ID ever reaches them, in
            the page address or as the previous page. It sets window.__gpc
            first: with Global Privacy Control on, the Meta pixel (the
            fbevents.js loader, init and PageView) is never loaded
            (lib/tracking-guard.ts). */}
        <script dangerouslySetInnerHTML={{ __html: trackingGuardScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <JsonLd data={ORGANIZATION} />
        <MetaPixelRouteTracker />
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
