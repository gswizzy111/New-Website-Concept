import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cart | The Card Doc" };

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
