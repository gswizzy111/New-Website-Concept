import type { WorkshopUserView } from "@/lib/workshop-users";
import { NOT_RECORDED, type ActivityKind } from "@/lib/team-activity";

/**
 * The Team and Activity pages' words, without the database (pure: tests,
 * server and client components). A person is the username a log line
 * recorded; a worker's display name (workshop_users.name) is shown with it.
 */

export type WorkerName = { name: string | null; active: boolean };

/** Workers by username (what every log line records). */
export function workerDirectory(workers: readonly Pick<WorkshopUserView, "username" | "name" | "active">[]): Map<string, WorkerName> {
  return new Map(workers.map((w) => [w.username, { name: w.name, active: w.active }]));
}

/** How a person shows: a worker's name (with their username), else the username; null = "Not recorded". */
export function personName(by: string | null, dir: ReadonlyMap<string, WorkerName>): { title: string; username: string | null; worker: boolean } {
  if (by === null) return { title: NOT_RECORDED, username: null, worker: false };
  const w = dir.get(by);
  if (w?.name && w.name !== by) return { title: w.name, username: by, worker: true };
  return { title: by, username: null, worker: !!w };
}

/** One line for a select or a CSV: "Sam Lee (sam)", "gavin", "Not recorded". */
export function personOption(by: string | null, dir: ReadonlyMap<string, WorkerName>): string {
  const p = personName(by, dir);
  return p.username ? `${p.title} (${p.username})` : p.title;
}

/** What the worker is called on the Team page. */
export function workerTitle(w: Pick<WorkshopUserView, "name" | "username">): string {
  return w.name?.trim() || w.username;
}

export type Tone = "green" | "amber" | "red" | "gray";

/** The worker's state, in plain words. */
export function workerStatus(w: Pick<WorkshopUserView, "active" | "hasPassword" | "setupPending">): { label: string; tone: Tone } {
  if (!w.active) return { label: "Turned off", tone: "gray" };
  if (w.hasPassword) return { label: "Active", tone: "green" };
  if (w.setupPending) return { label: "Waiting for setup", tone: "amber" };
  return { label: "Setup link expired", tone: "red" };
}

/** Under the setup link (the owner gives it to the worker; it isn't emailed). */
export function setupLinkText(name: string): string {
  return `Send this link to ${name}. It works once, for 7 days.`;
}

const NY = "America/New_York";

/** "Nov 26, 4:12 PM" in New York (the year when it isn't this year's). */
export function shortWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const year = (x: Date) => x.toLocaleDateString("en-US", { timeZone: NY, year: "numeric" });
  return d.toLocaleString("en-US", {
    timeZone: NY,
    month: "short",
    day: "numeric",
    ...(year(d) !== year(now) ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Last sign-in Nov 26, 4:12 PM" / "Never signed in". */
export function lastSignInText(iso: string | null, now: Date = new Date()): string {
  return iso ? `Last sign-in ${shortWhen(iso, now)}` : "Never signed in";
}

/** "1 card", "12 cards". */
export function cardsText(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

/** The colour of an action's tag (dark text on a light fill: AA contrast). */
export const KIND_TONE: Record<ActivityKind, string> = {
  received: "bg-blue-100 text-blue-900",
  moved: "bg-violet-100 text-violet-900",
  done: "bg-green-100 text-green-900",
  taken_out: "bg-amber-100 text-amber-900",
  step: "bg-purple-100 text-purple-900",
  photo: "bg-sky-100 text-sky-900",
  label_printed: "bg-slate-100 text-slate-800",
  card_added: "bg-teal-100 text-teal-900",
  unreceived: "bg-red-100 text-red-900",
  new_round: "bg-orange-100 text-orange-900",
  due_date: "bg-gray-100 text-gray-800",
};

// ─── The Team page's actions ─────────────────────────────────────────────

const devices = (n: number) => `${n} device${n === 1 ? "" : "s"}`;

/** After "Sign out everywhere". */
export function signedOutText(ended: number): string {
  return ended ? `Signed out on ${devices(ended)}.` : "They weren't signed in anywhere.";
}

/** After "Turn off". */
export function turnedOffText(ended: number): string {
  return `Turned off.${ended ? ` Signed out on ${devices(ended)}.` : ""} They can't sign in until you turn them back on.`;
}

/** After "Turn on". */
export function turnedOnText(w: Pick<WorkshopUserView, "hasPassword">): string {
  return w.hasPassword ? "Turned on. They can sign in again." : "Turned on. They still need a password: make a new setup link.";
}

export type RowAction = "off" | "on" | "reset" | "signout";

/** The question an action asks first, and its yes button ("on" asks nothing). */
export function confirmFor(action: Exclude<RowAction, "on">, w: Pick<WorkshopUserView, "name" | "username" | "hasPassword">): { question: string; yes: string } {
  const name = workerTitle(w);
  if (action === "off") return { question: `Turn off ${name}? They're signed out now and can't sign in until you turn them back on.`, yes: "Yes, turn off" };
  if (action === "signout") return { question: `Sign ${name} out on every device? Their password still works, so they can sign in again.`, yes: "Yes, sign out everywhere" };
  return w.hasPassword
    ? { question: `Make a new setup link for ${name}? Their password stops working now and they're signed out everywhere until they choose a new one.`, yes: "Yes, make a new link" }
    : { question: `Make a new setup link for ${name}? Any earlier link stops working.`, yes: "Yes, make a new link" };
}
