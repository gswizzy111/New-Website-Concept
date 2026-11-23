/**
 * When Receiving went live (Nov 23, 2026, 1 p.m. New York). The owner's call:
 * orders already in the shop before then stay out of the new system; only
 * orders that were still Awaiting Cards (or came in afterwards) go through
 * Receiving. The Receiving queues use it so older orders never show up there.
 */
export const INTAKE_START = "2026-11-23T18:00:00Z";
