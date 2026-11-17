"use client";

export function ExportButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      download
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cobalt text-white text-sm font-bold hover:bg-cobalt/90 transition-colors"
    >
      ↓ Export Excel / CSV
    </a>
  );
}
