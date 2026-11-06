import { Microscope, Sparkles, Wrench } from "lucide-react";

export const SERVICE_CARDS = [
  {
    href: "/tier-selection",
    code: "Service",
    name: "Restoration",
    line: "Surfaces, corners & edges — cleaned and restored to their best.",
    price: "From $75 / card",
    action: "View Tiers",
    Icon: Sparkles,
    band: "bg-rx text-white",
    dots: "halftone-light",
  },
  {
    href: "/prep",
    code: "Service",
    name: "Prep",
    line: "Grade-ready submission prep for PSA, BGS & CGC.",
    price: "From $25 / card",
    action: "View Pricing",
    Icon: Microscope,
    band: "bg-ink text-white",
    dots: "halftone-light",
  },
  {
    href: "/shop",
    code: "Shop",
    name: "DIY Kits",
    line: "The same pro-grade tools The Card Doc uses — delivered to you.",
    price: "US shipping at cost + $2 handling",
    action: "Shop Now",
    Icon: Wrench,
    band: "bg-peach text-ink",
    dots: "halftone",
  },
];
