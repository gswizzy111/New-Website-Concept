import { ViewTransition } from "react";

/**
 * Page changes: the old page lifts away and the new one rises in (CSS in
 * globals.css, "Page transitions"). The header, phone menu, booking dock and
 * grain stay still above it. Only route changes animate (default="none").
 */
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
