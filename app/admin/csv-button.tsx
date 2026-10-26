"use client";

import { csvText, type CsvValue } from "@/lib/csv";

// Downloads the rows shown on the page as a CSV file (built in the browser).
// Cells are guarded against spreadsheet formulas in lib/csv.ts.
export function CsvButton({ rows, filename }: { rows: CsvValue[][]; filename: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="h-9 px-4 rounded-lg border border-border bg-white text-sm font-semibold text-foreground whitespace-nowrap hover:border-foreground/40 transition-colors"
    >
      Download CSV
    </button>
  );
}
