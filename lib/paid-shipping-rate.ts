/**
 * The admin label buttons default to the shipping the customer paid for
 * (e.g. Priority Mail) instead of the cheapest rate (usually Ground
 * Advantage). The rates stay cheapest first; the paid one is kept in the
 * list even when it isn't among the cheapest and is marked `paid`.
 */

type ShippoRateLike = {
  provider: string;
  amount: string;
  servicelevel?: { name?: string | null; token?: string | null } | null;
};

/** "Standard℠", "3 Day Select®" and "priority_mail" compare as plain words */
function norm(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[®℠™]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether a Shippo rate is the service the customer paid for. `service` is
 * the service name as saved at checkout ("Priority Mail"), or carrier and
 * service together ("USPS Priority Mail", kit orders).
 */
function isPaidRate(rate: ShippoRateLike, paid: { carrier?: string | null; service?: string | null }): boolean {
  const service = norm(paid.service);
  if (!service) return false;
  const carrier = norm(paid.carrier);
  const provider = norm(rate.provider);
  if (carrier && carrier !== provider) return false;
  const names = [rate.servicelevel?.name, rate.servicelevel?.token].map(norm).filter(Boolean);
  return names.some((name) => name === service || `${provider} ${name}` === service);
}

/**
 * The rates to offer, cheapest first, at most `max`. When one matches the
 * service the customer paid for, it is always in the list and flagged.
 */
export function ratesWithPaidService<T extends ShippoRateLike>(
  rates: T[],
  paid: { carrier?: string | null; service?: string | null } | null,
  max = 5,
): { rate: T; paid: boolean }[] {
  const sorted = [...rates].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
  const paidRate = paid ? sorted.find((r) => isPaidRate(r, paid)) : undefined;
  let list = sorted.slice(0, max);
  if (paidRate && !list.includes(paidRate)) {
    list = [...list.slice(0, Math.max(0, max - 1)), paidRate];
  }
  return list.map((rate) => ({ rate, paid: rate === paidRate }));
}
