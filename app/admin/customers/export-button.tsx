"use client";

import { csvText } from "@/lib/csv";

type Customer = {
  name: string;
  email: string;
  phone: string;
  source: string;
  firstOrder: string;
  totalOrders: number | null;
};

export function ExportButton({ customers }: { customers: Customer[] }) {
  function download() {
    const headers = ["Name", "Email", "Phone", "Source", "First Order", "Total Orders"];
    const rows = customers.map((c) => [
      c.name,
      c.email,
      c.phone,
      c.source,
      new Date(c.firstOrder).toLocaleDateString("en-US", { timeZone: "America/New_York" }),
      c.totalOrders != null ? String(c.totalOrders) : "",
    ]);

    // Guarded against spreadsheet formulas (a name or phone typed at checkout can start with = or +)
    const blob = new Blob([csvText([headers, ...rows])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      onClick={download}
      className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:opacity-90 transition-opacity"
    >
      Download CSV ({customers.length})
    </button>
  );
}
