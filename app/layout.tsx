import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelRouteTracker } from "@/components/meta-pixel-route-tracker";
import { PIXEL_ID } from "@/lib/pixel";

const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  // Matches the paper header at the top of every page.
  themeColor: "#fbfcfb",
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
    <html lang="en" className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <meta name="facebook-domain-verification" content="ihjnpqbitwq29e5kx3x0dujilxh1n9" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-LSQXS277DY" />
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-LSQXS277DY');
        `}} />
        {/* Meta Pixel — init + initial PageView */}
        <script dangerouslySetInnerHTML={{ __html: `
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
          document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','${PIXEL_ID}');
          fbq('track','PageView');
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
