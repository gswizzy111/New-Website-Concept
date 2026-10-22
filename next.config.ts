import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Animates route changes through React's <ViewTransition> (app/(public)/template.tsx).
    viewTransition: true,
  },
  turbopack: {
    rules: {
      // The legal texts in legal/*.md are imported as plain strings (lib/legal/current-terms.ts).
      "*.md": { type: "raw" },
    },
  },
};

export default nextConfig;
