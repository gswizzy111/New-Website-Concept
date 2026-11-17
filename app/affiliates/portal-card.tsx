import { PIXEL_FIELD } from "@/components/ui/input";
import { FIELD_LABEL, PORTAL_BUTTON, PortalCard as Card } from "@/components/account/portal";

/** The creator portal's centered card: sign-in and password setup. */
export function PortalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card title={title} width="max-w-sm">
      {children}
    </Card>
  );
}

export const PORTAL_LABEL_CN = FIELD_LABEL;
export const PORTAL_INPUT_CN = PIXEL_FIELD;
export const PORTAL_BUTTON_CN = PORTAL_BUTTON;
