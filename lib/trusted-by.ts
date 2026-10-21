/**
 * People The Card Doc has restored cards for, shown in the "Trusted by" row on
 * the home page. Only add someone with a confirmed order or conversation; the
 * section stays hidden while this list is empty.
 *
 * One entry per person, using their real handle and link:
 *   { name: "Real Name", handle: "@handle", role: "What they're known for", platform: "Instagram", href: "https://www.instagram.com/handle", followers: "1.2M" }
 * `role` and `followers` are optional; leave them out rather than guess.
 */
export type TrustedPage = {
  name: string;
  handle: string;
  role?: string;
  platform: "Instagram" | "TikTok" | "YouTube" | "Facebook" | "X";
  href: string;
  followers?: string;
};

export const TRUSTED_BY: TrustedPage[] = [
  {
    name: "Joey Valence",
    handle: "@joeyvalence",
    role: "Rapper, Joey Valence & Brae",
    platform: "Instagram",
    href: "https://www.instagram.com/joeyvalence/",
    followers: "420K",
  },
  {
    name: "Boston Scott",
    handle: "@bnsvi_",
    role: "Former Philadelphia Eagles running back",
    platform: "Instagram",
    href: "https://www.instagram.com/bnsvi_/",
    followers: "98K",
  },
];
