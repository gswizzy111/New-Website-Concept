import { ViewTransition } from "react";

/**
 * Page changes: the old page fades out and the new one rises a few pixels
 * into place (CSS in globals.css, "Page transitions"). The header, phone
 * menu and booking dock stay still above it. Only route changes animate
 * (default="none").
 */
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
