import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, Young_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelRouteTracker } from "@/components/meta-pixel-route-tracker";
import { PIXEL_ID } from "@/lib/pixel";

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
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-LSQXS277DY" />
        {/* Pages whose address holds a one-time account link (confirm email,
            reset password) aren't reported to analytics or the pixel: both
            record the full URL, token included. */}
        <script dangerouslySetInnerHTML={{ __html: `
          window.__noTrack = /^\\/account\\/(confirm|reset-password)(\\/|$)/.test(location.pathname);
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          if (!window.__noTrack) gtag('config', 'G-LSQXS277DY');
        `}} />
        {/* Meta Pixel — init + initial PageView */}
        <script dangerouslySetInnerHTML={{ __html: `
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
          document,'script','https://connect.facebook.net/en_US/fbevents.js');
          if (!window.__noTrack) {
            fbq('init','${PIXEL_ID}');
            fbq('track','PageView');
          }
        `}} />
      </head>
      <body className="min-h-full flex flex-col">
        <MetaPixelRouteTracker />
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
