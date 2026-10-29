/**
 * CSV files the admin downloads (customers, tax, sales statement, backlog,
 * services). Text that a spreadsheet would run as a formula (it starts with
 * =, +, -, @, a tab or a carriage return) gets a leading apostrophe, so Excel
 * and Sheets show it as text. Numbers, and text that is only a number such
 * as "-12.50", stay numbers.
 */
export type CsvValue = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: CsvValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = FORMULA_START.test(v) && !PLAIN_NUMBER.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: CsvValue[]): string {
  return cells.map(csvCell).join(",");
}

/** The whole file, with a byte-order mark so Excel reads it as UTF-8. */
export function csvText(rows: CsvValue[][]): string {
  return "﻿" + rows.map(csvLine).join("\r\n");
}
