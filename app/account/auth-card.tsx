import { PIXEL_FIELD } from "@/components/ui/input";
import { FIELD_LABEL, PORTAL_BUTTON, PortalCard } from "@/components/account/portal";

/** The customer portal's centered card: confirm, forgot and reset password. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PortalCard eyebrow="Customer portal" title={title}>
      {children}
    </PortalCard>
  );
}

export const FIELD_CN = PIXEL_FIELD;
export const LABEL_CN = FIELD_LABEL;
export const BUTTON_CN = PORTAL_BUTTON;
