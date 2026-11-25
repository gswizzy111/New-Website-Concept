/**
 * The Open bags box's A-Z dividers (owner, Nov 25 2026: "A-Z box by last
 * name"): a bag is filed under the first letter of the customer's LAST name,
 * so "Maria Reyes" goes under R. Pure (safe in client components, label
 * layouts and tests).
 *
 * Rules:
 * - The last name is the last word of the name ("Maria De La Cruz" -> Cruz).
 *   Suffixes are skipped ("John Smith Jr." -> Smith), and a name written
 *   last name first keeps it ("Reyes, Maria" -> Reyes).
 * - Its first letter, upper case, accents dropped ("Ávila" -> A, "o'neil" -> O).
 * - No letter there (a number, a name in another alphabet): the first letter
 *   of the whole name; still none (or no name at all): "#".
 */

/** The divider for names without an A-Z letter. */
export const NO_LETTER = "#";

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "MD", "PHD", "ESQ", "DDS", "DVM", "CPA"]);

const clean = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const isSuffix = (word: string) => SUFFIXES.has(word.replace(/[^\p{L}]/gu, "").toUpperCase());

/** "Ávila" -> "A", "o'neil" -> "O", "3rd" / "王" / "" -> null: the first A-Z letter a word starts with, leading marks skipped. */
function firstLatinLetter(word: string): string | null {
  const start = word.replace(/^[^\p{L}\p{N}]+/u, "");
  const ch = start.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(ch) ? ch : null;
}

function words(s: string): string[] {
  return s.split(" ").map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

/**
 * The customer's last name as written ("Reyes" for "Maria Reyes", "Reyes, Maria"
 * or "Maria Reyes Jr."), null when there is no name.
 */
export function customerLastName(name: string | null | undefined): string | null {
  const raw = clean(typeof name === "string" ? name : "");
  if (!raw) return null;
  // "Reyes, Maria" (last name first) but not "John Smith, Jr."
  const parts = raw.split(",").map((p) => p.trim()).filter((p, i) => p && (i === 0 || !words(p).every(isSuffix)));
  const lastNamePart = parts.length >= 2 ? parts[0] : parts.join(" ");
  const all = words(lastNamePart);
  const kept = all.filter((w) => !isSuffix(w));
  return (kept.length ? kept : all).at(-1) ?? null;
}

/** The Open bags box divider for a customer: "R" for "Maria Reyes"; "#" when the name has no A-Z letter to file by. */
export function filingLetter(name: string | null | undefined): string {
  const last = customerLastName(name);
  if (last) {
    const letter = firstLatinLetter(last);
    if (letter) return letter;
  }
  const whole = clean(typeof name === "string" ? name : "");
  for (const w of words(whole)) {
    const letter = firstLatinLetter(w);
    if (letter) return letter;
    break; // only the name's first word: "first letter of the name"
  }
  return NO_LETTER;
}
