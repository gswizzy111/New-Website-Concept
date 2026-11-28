import { createAdminClient } from "@/lib/supabase/admin";
import { PREVIEW_MODE } from "@/lib/preview";
import { isMissingTable } from "@/lib/sms/db";

export type SmsMessageKind = "received" | "completed" | "shipped" | "waitlist_open" | "reply";
export type SmsMessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "unknown" | "skipped" | "expired";

export type SmsMessageRow = {
  id: string;
  order_id: string | null;
  kind: SmsMessageKind;
  to_phone: string;
  body: string | null;
  status: SmsMessageStatus;
  skip_reason: string | null;
  send_after: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  attempts: number;
  telnyx_message_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SmsInboundRow = {
  id: string;
  from_phone: string;
  to_phone: string | null;
  body: string | null;
  telnyx_message_id: string | null;
  keyword: string | null;
  order_id: string | null;
  forwarded_at: string | null;
  handled_at: string | null;
  created_at: string;
};

export async function markDelivery(telnyxMessageId: string, status: "sent" | "delivered" | "failed", error?: string | null): Promise<void> {
  void telnyxMessageId; void status; void error; void PREVIEW_MODE; void isMissingTable;
}

export async function smsForOrder(orderId: string): Promise<{
  setUp: boolean;
  consent: { phone: string; source: string; createdAt: string } | null;
  optedOut: boolean;
  messages: SmsMessageRow[];
}> {
  void orderId; void createAdminClient;
  return { setUp: false, consent: null, optedOut: false, messages: [] };
}

export async function recentSms(o?: { limit?: number }): Promise<{
  setUp: boolean;
  messages: SmsMessageRow[];
  inbound: SmsInboundRow[];
  optOuts: { phone: string; at: string; keyword: string | null }[];
}> {
  void o;
  return { setUp: false, messages: [], inbound: [], optOuts: [] };
}
