/**
 * Pages The Card Doc has restored cards for, shown in the "Trusted by" row on
 * the home page. The section stays hidden while this list is empty.
 *
 * Add one entry per page, using the page's real handle and link:
 *   { name: "@handle", platform: "Instagram", href: "https://www.instagram.com/handle", followers: "1.2M" }
 * `followers` is optional; leave it out rather than guess.
 */
export type TrustedPage = {
  name: string;
  platform: "Instagram" | "TikTok" | "YouTube" | "Facebook" | "X";
  href: string;
  followers?: string;
};

// PLACEHOLDERS so the row is visible on the preview. Replace with the real
// pages (and their links) before launch.
export const TRUSTED_BY: TrustedPage[] = [
  { name: "@your_page_here", platform: "Instagram", href: "https://www.instagram.com/the_card_doc", followers: "1.2M" },
  { name: "@big_page_name", platform: "TikTok", href: "https://www.instagram.com/the_card_doc", followers: "850K" },
  { name: "Page Name Here", platform: "YouTube", href: "https://www.instagram.com/the_card_doc", followers: "400K" },
  { name: "@another_page", platform: "Instagram", href: "https://www.instagram.com/the_card_doc", followers: "310K" },
  { name: "@page_name", platform: "Facebook", href: "https://www.instagram.com/the_card_doc", followers: "1.4M" },
];
