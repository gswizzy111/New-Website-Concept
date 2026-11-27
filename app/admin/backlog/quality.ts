import type { BacklogQuality } from "@/lib/dashboard-metrics";

// How the Backlog page, its CSV and the backlog chart label a day: exact
// (logged move by move, or today so far) or estimated (rebuilt from the order
// status history). Days with too little history have no total at all.

export const BACKLOG_DAY_LABEL: Record<BacklogQuality, string> = {
  live: "Live",
  recorded: "Exact",
  reconstructed: "Estimated",
  approximate: "Rough estimate",
  insufficient: "Not enough data",
  no_data: "No data",
};

export const BACKLOG_DAY_CLS: Record<BacklogQuality, string> = {
  live:          "bg-emerald-100 text-emerald-700",
  recorded:      "bg-teal-50 text-teal-700",
  reconstructed: "bg-amber-50 text-amber-700",
  approximate:   "bg-amber-100 text-amber-800",
  insufficient:  "bg-red-100 text-red-700",
  no_data:       "bg-gray-100 text-gray-600",
};

/** A day whose total is an estimate rather than an exact count. */
export function backlogEstimated(q: BacklogQuality): boolean {
  return q === "reconstructed" || q === "approximate";
}
