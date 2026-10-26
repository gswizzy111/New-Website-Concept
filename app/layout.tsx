import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, Young_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelRouteTracker } from "@/components/meta-pixel-route-tracker";
import { trackingGuardScript } from "@/lib/tracking-guard";
import { siteUrl } from "@/lib/site-url";

// Headings: a soft, heavy old-style serif with the feel of vintage card print.
// It ships in one weight; globals.css turns off faux bold for it.
const youngSerif = Young_Serif({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
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
  themeColor: "#f6f5f2",
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
    <html lang="en" className={`${youngSerif.variable} ${schibsted.variable} h-full antialiased`}>
      <head>
        <meta name="facebook-domain-verification" content="ihjnpqbitwq29e5kx3x0dujilxh1n9" />
        {/* Runs before anything else on the page and loads Google Analytics
            and the Meta pixel itself, after taking Stripe session IDs out of
            the address and only on pages that may be reported: no email,
            case link, one-time token or session ID ever reaches them, in
            the page address or as the previous page (lib/tracking-guard.ts). */}
        <script dangerouslySetInnerHTML={{ __html: trackingGuardScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <MetaPixelRouteTracker />
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
