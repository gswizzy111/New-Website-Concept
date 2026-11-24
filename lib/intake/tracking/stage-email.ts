import "server-only";
import { STAGE_INFO, friendlyStage } from "@/lib/restoration-stages";
import { escapeHtml, sendOrderUpdateEmail, type EmailOrder } from "@/lib/customer-email";

/**
 * The one "Restoration Update" email for an order's cards that moved to a new
 * step in one scan request. Same subject, heading and body as advanceCards()
 * in lib/intake/stages.ts (one card: its stage box; several: the list and a
 * box per stage), so a scan reads exactly like the stage buttons. Cards that
 * moved to different steps in one request still get one email. Returns
 * whether it was sent (never throws).
 */
export async function sendStageUpdateEmail(
  order: EmailOrder,
  lines: readonly { name: string | null; stage: string; round: number }[],
): Promise<boolean> {
  if (!lines.length) return false;
  const rows = lines.map((l) => ({ name: l.name ?? "Your card", stage: l.stage, friendly: friendlyStage(l.stage, l.round) }));
  const friendlies = [...new Set(rows.map((l) => l.friendly))];
  const stages = [...new Set(rows.map((l) => l.stage))];
  const box = (stage: string, friendly: string) => `
     <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;margin:20px 0">
       <p style="margin:0;font-size:13px;color:#6d28d9;font-weight:700">${escapeHtml(friendly)}</p>
       <p style="margin:6px 0 0;font-size:15px">${escapeHtml(STAGE_INFO[stage]?.explanation ?? "")}</p>
     </div>`;
  const single = rows.length === 1;
  const subject = single
    ? `Update on your card — ${rows[0].friendly} (Order #${order.order_number})`
    : friendlies.length === 1
      ? `Update on your cards — ${friendlies[0]} (Order #${order.order_number})`
      : `Update on your cards (Order #${order.order_number})`;
  const body = single
    ? `<p><strong>${escapeHtml(rows[0].name)}</strong> has moved to a new stage.</p>${box(rows[0].stage, rows[0].friendly)}`
    : `<p>${rows.length} of your cards have moved to a new stage:</p>
     <ul style="padding-left:20px;margin:12px 0">${rows.map((l) => `<li><strong>${escapeHtml(l.name)}</strong> — ${escapeHtml(l.friendly)}</li>`).join("")}</ul>
     ${stages.map((s) => box(s, rows.find((l) => l.stage === s)!.friendly)).join("")}`;
  return sendOrderUpdateEmail(order, subject, "Restoration Update", body);
}
