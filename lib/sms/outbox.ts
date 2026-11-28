export type ProcessSmsOutboxResult = { sent: number; held: number; skipped: number; failed: number; expired: number; notSetUp?: boolean };

export async function processSmsOutbox(o?: { limit?: number }): Promise<ProcessSmsOutboxResult> {
  void o;
  return { sent: 0, held: 0, skipped: 0, failed: 0, expired: 0, notSetUp: true };
}

export async function sendOneOffSms(i: {
  to: string;
  text: string;
  kind: "reply" | "waitlist_open";
  orderId?: string | null;
  createdBy?: string | null;
  allowWithoutConsent?: boolean;
}): Promise<{ ok: boolean; error: string | null }> {
  void i;
  return { ok: false, error: "Texts aren't set up yet." };
}
