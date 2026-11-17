import type { StaticImageData } from "next/image";
import t1 from "@/public/testimonial-1.jpeg";
import t3 from "@/public/testimonial-3.jpeg";
import t4 from "@/public/testimonial-4.jpeg";
import t5 from "@/public/testimonial-5.png";
import t6 from "@/public/testimonial-6.png";
import t11 from "@/public/testimonial-11.png";
import t12 from "@/public/testimonial-12.png";
import t13 from "@/public/testimonial-13.png";

/**
 * The real DM screenshots from lib/testimonials.ts' list, as static imports
 * (sizes and blur known at build time). Alt text carries the customer's own
 * words. testimonial-2 is left out: it shows a customer's first name, and
 * the owner asked for no customer names on the site.
 */
export type Receipt = {
  id: string;
  src: StaticImageData;
  alt: string;
  /** The screenshot's own background, so a contained image sits flush. */
  matte: string;
};

const DARK = "#000000";

export const RECEIPTS: Receipt[] = [
  { id: "t11", src: t11, matte: DARK, alt: "Instagram message from a customer: “Dude incredible work on the charizard!!!” and “It looks fantastic”" },
  { id: "t3", src: t3, matte: DARK, alt: "Instagram message from a customer about a Charmander: “I genuinely can’t believe the transformation. You are a master of your work my man!”" },
  { id: "t1", src: t1, matte: DARK, alt: "Instagram message from a customer: “Umbreon just came in and wow! looks so much better. You guys killed it, thank you!”" },
  { id: "t6", src: t6, matte: DARK, alt: "Message from a customer: “I just wanted to say your kit is amazing!” and “your polish took them all out! Thank you Card Doc:)”" },
  { id: "t4", src: t4, matte: DARK, alt: "Message from a customer: “Just got her back today looks way better! Appreciate you expediting the shipping. Hoping for a PSA 8-9”" },
  { id: "t5", src: t5, matte: DARK, alt: "Text message from a customer: “Sending out the Charizard tmrw morning!” and “I think your restoration made all the difference !”" },
  { id: "t13", src: t13, matte: DARK, alt: "Instagram message from a customer: “saw the video you posted on my Brady card. Amazing work!!!”" },
  { id: "t12", src: t12, matte: DARK, alt: "Instagram messages from a customer: “Just got here” and “Looks great, thank you again”" },
];

export function receipt(id: string): Receipt {
  const r = RECEIPTS.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown receipt ${id}`);
  return r;
}
