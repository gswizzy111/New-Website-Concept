import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelRouteTracker } from "@/components/meta-pixel-route-tracker";
import { trackingGuardScript } from "@/lib/tracking-guard";
import { siteUrl } from "@/lib/site-url";
import { JsonLd } from "@/components/seo/json-ld";
import { ORGANIZATION } from "@/lib/seo";

// Display: headlines, step numerals, stickers and short uppercase labels.
// Big Shoulders is the merged Google family; its optical-size axis gives the
// condensed "Display" cut at headline sizes and a more open cut at label
// sizes (font-optical-sizing: auto).
const bigShoulders = Big_Shoulders({
  variable: "--font-heading",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

// Body, UI, forms, buttons and legal text.
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
  // Matches the white header at the top of every page.
  themeColor: "#ffffff",
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
    <html lang="en" className={`${bigShoulders.variable} ${schibsted.variable} h-full antialiased`}>
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
