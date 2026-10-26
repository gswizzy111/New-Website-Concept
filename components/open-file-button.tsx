"use client";

import type { ReactNode } from "react";

/**
 * Opens a file on another site (a Shippo shipping label) in a new tab, from a
 * button rather than a link. Google Analytics records clicks on links to other
 * sites and on file links with their full address; a label's address opens a
 * PDF with the customer's name and address, so on a page that loads analytics
 * it must not be a link. The trackers only see links, not this.
 */
export function OpenFileButton({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
      {children}
    </button>
  );
}
