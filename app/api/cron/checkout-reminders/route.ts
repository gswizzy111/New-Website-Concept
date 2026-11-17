import { PREVIEW_MODE } from "@/lib/preview";
import { sendCheckoutReminders } from "@/lib/checkout-reminder";

// Runs every 5 minutes via netlify/functions/cron-checkout-reminders.mjs.
// Emails restoration and prep customers who reached Stripe but didn't pay,
// once, while their payment page is still open (lib/checkout-reminder.ts).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  // As the other cron routes, plus: no secret set means no access
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Preview deploys send no email and write nothing
  if (PREVIEW_MODE) {
    return Response.json({ preview: true, checked: 0, sent: 0, skipped: {} });
  }

  try {
    const counts = await sendCheckoutReminders();
    console.log("[cron/checkout-reminders]", JSON.stringify(counts));
    return Response.json(counts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/checkout-reminders] failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
