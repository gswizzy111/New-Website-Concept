"use server";

import { updateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { DASHBOARD_METRICS_TAG } from "./dashboard-metrics-cache";

/**
 * Drops the dashboard's cached metrics (app/admin/dashboard-metrics-cache.ts)
 * after an admin changes what they count, here a refund request approved or
 * denied. As a Server Action that updates a tag, its response re-renders the
 * current page, so the caller needs no router.refresh() on top.
 */
export async function refreshDashboardMetrics() {
  await requireAdmin();
  updateTag(DASHBOARD_METRICS_TAG);
}
