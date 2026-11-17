import { Inter, Playfair_Display } from "next/font/google";
import "@/app/admin/admin-legacy.css";

// thecarddoc1.com's admin look (Inter body, Playfair Display headings and
// app/admin/admin-legacy.css) for staff pages outside /admin: the accountant
// and support invite setup pages, which lead to /admin/login. The same scope
// app/admin/layout.tsx puts around the admin.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700", "900"],
});

export function AdminLook({ children }: { children: React.ReactNode }) {
  return <div className={`admin-legacy contents ${inter.variable} ${playfair.variable}`}>{children}</div>;
}
