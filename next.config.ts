import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Animates route changes through React's <ViewTransition> (app/(public)/template.tsx).
    viewTransition: true,
  },
  async redirects() {
    return [
      // The separate High-Value Card Agreement ended with Terms v1.1. The
      // archived Terms (v0.9, stored word for word) still link to its page,
      // and its emailed signing links went under it: send both to the Terms
      // that described it (v1.0, Section 4).
      { source: "/agreements/high-value/:path*", destination: "/terms/v1.0", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // A page's address can hold an email or a one-time link, so links and
        // requests pass on only the site's origin as the referrer (also set in
        // the root layout's metadata; lib/tracking-guard.ts).
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "strict-origin" }],
      },
    ];
  },
};

export default nextConfig;
