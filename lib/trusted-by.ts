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

export const TRUSTED_BY: TrustedPage[] = [];
