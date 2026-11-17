"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// thecarddoc1.com has no not-found page, so a missing admin page (an unknown
// /admin address, or notFound() from an admin page) shows Next.js's built-in
// 404 on its own, outside the admin menu. The root not-found renders this for
// /admin paths, with the same markup and styles, and the public site's
// branded 404 everywhere else.
const styles = {
  error: {
    fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
    height: "100vh",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  desc: { display: "inline-block" },
  // The redesign's global heading rules (display font, letter spacing) don't reach it
  h1: {
    display: "inline-block",
    margin: "0 20px 0 0",
    padding: "0 23px 0 0",
    fontFamily: "inherit",
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: "normal",
    fontFeatureSettings: "normal",
    verticalAlign: "top",
    lineHeight: "49px",
  },
  h2: {
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 400,
    letterSpacing: "normal",
    fontFeatureSettings: "normal",
    lineHeight: "49px",
    margin: 0,
  },
} as const;

const TITLE = "404: This page could not be found.";

function PlainNotFound() {
  useEffect(() => {
    document.title = TITLE;
  }, []);
  return (
    <div style={styles.error}>
      <div>
        <style
          dangerouslySetInnerHTML={{
            __html:
              "body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}",
          }}
        />
        <h1 className="next-error-h1" style={styles.h1}>404</h1>
        <div style={styles.desc}>
          <h2 style={styles.h2}>This page could not be found.</h2>
        </div>
      </div>
    </div>
  );
}

/** Next.js's plain 404 under /admin (as on thecarddoc1.com); `children` (the branded 404) elsewhere. */
export function AdminAwareNotFound({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <PlainNotFound />;
  return <>{children}</>;
}
