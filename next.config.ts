import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Animates route changes through React's <ViewTransition> (app/(public)/template.tsx).
    viewTransition: true,
  },
};

export default nextConfig;
