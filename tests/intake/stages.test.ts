/** Per-card steps in any order, the customer email rule, bulk planning and bag completion (lib/intake/stage-plan.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "@/lib/restoration-stages";
import {
  bagCompletionPatch, cardStageState, furthestStageIndex, isBagComplete, nextStepAfter, planAdvance, stageGroups, stepEmailsCustomer,
  type AdvanceCard,
} from "@/lib/intake/stage-plan";
import type { StageEventRow } from "@/lib/intake/types";

let clock = Date.parse("2026-11-16T14:00:00Z");
/** A stage_update event as the stage buttons write it. */
function stage(cardId: string, s: string, round = 1, extra: Record<string, unknown> = {}): StageEventRow {
  clock += 60_000;
  return {
    event_type: "stage_update",
    description: `Stage: ${s} [card:${cardId}]`,
    metadata: { card_id: cardId, stage: s, round, ...extra },
    created_at: new Date(clock).toISOString(),
  };
}
/** Newest first, as the loaders read them. */
const newestFirst = (events: StageEventRow[]) => [...events].reverse();

test("not started: next step is Ready for Slab Crack, all 8 remaining", () => {
  const st = cardStageState({ id: "a", completed: false }, []);
  assert.equal(st.current, null);
  assert.equal(st.currentIndex, -1);
  assert.equal(st.currentLabel, "Not started");
  assert.deepEqual(st.remainingStages, [...STAGES]);
  assert.deepEqual(st.doneStages, []);
  assert.deepEqual(st.next, { kind: "stage", stage: "Ready for Slab Crack", label: "Ready for Slab Crack" });
});

test("mid-way: current, done, remaining, admin labels, history with time and employee", () => {
  const events = [
    stage("a", "Ready for Slab Crack", 1, { by: "gavin" }),
    stage("b", "Humidor"),
    stage("a", "Humidor", 1, { by: "sam", bulk: true }),
    stage("a", "Humidity Press"),
  ];
  const st = cardStageState({ id: "a", completed: false, current_round: 1, received_at: "2026-11-16T13:00:00Z", received_by: "gavin" }, newestFirst(events));
  assert.equal(st.current, "Humidity Press");
  assert.equal(st.currentIndex, 2);
  assert.deepEqual(st.doneStages, ["Ready for Slab Crack", "Humidor"]);
  assert.equal(st.remainingStages.length, 5);
  assert.deepEqual(st.next, { kind: "stage", stage: "Book", label: "Drying" });
  assert.deepEqual(st.history.map((h) => [h.kind, h.label, h.by]), [
    ["received", "Received", "gavin"],
    ["stage", "Ready for Slab Crack", "gavin"],
    ["stage", "Humidor", "sam"],
    ["stage", "Humidity Press", null],
  ]);
  assert.equal(st.history[2].bulk, true);
  assert.equal(st.updatedAt, events[3].created_at);
});

test("Final Dry: the next step is Done; a done card has nothing left", () => {
  const atFinal = cardStageState({ id: "a", completed: false }, newestFirst([stage("a", "Final Dry")]));
  assert.deepEqual(atFinal.next, { kind: "complete", label: "Done" });
  // Jumped straight to Final Dry: the 7 steps it skipped are not "done"
  assert.deepEqual(atFinal.doneStages, []);
  assert.deepEqual(atFinal.remainingStages, STAGES.slice(0, 7));
  assert.equal(atFinal.furthestIndex, 7);
  const done = cardStageState({ id: "a", completed: true, completed_at: "2026-11-20T10:00:00Z" }, newestFirst([stage("a", "Final Dry")]));
  assert.equal(done.currentLabel, "Done");
  assert.equal(done.currentIndex, STAGES.length);
  assert.equal(done.next, null);
  assert.deepEqual(done.doneStages, [...STAGES]);
  assert.equal(done.history.at(-1)?.kind, "completed");
  assert.deepEqual(nextStepAfter("Final Dry"), { kind: "complete", label: "Done" });
});

test("a new round starts with no stage; earlier rounds stay in the history", () => {
  const events = [stage("a", "Final Dry", 1), { event_type: "round_started", description: "Round 2 started for X", metadata: { card_id: "a", round: 2 }, created_at: new Date(clock += 60_000).toISOString() }];
  const st = cardStageState({ id: "a", completed: false, current_round: 2 }, newestFirst(events));
  assert.equal(st.current, null);
  assert.equal(st.round, 2);
  assert.deepEqual(st.history.map((h) => h.label), ["Final Dry", "Round 2 started"]);
  const later = cardStageState({ id: "a", completed: false, current_round: 2 }, newestFirst([...events, stage("a", "Humidor", 2)]));
  assert.equal(later.current, "Humidor");
  assert.equal(later.history.at(-1)?.label, "Round 2 · Humidor");
});

const card = (id: string, current: string | null, over: Partial<AdvanceCard> = {}): AdvanceCard =>
  ({ id, current, completed: false, refunded: false, awaiting: false, round: 1, ...over });

test("bulk advance moves only the cards at the chosen step; others are skipped, never overwritten", () => {
  const cards = [card("a", "Humidor"), card("b", "Humidor"), card("c", "Book"), card("d", null), card("e", "Humidor", { refunded: true }),
    card("f", null, { completed: true }), card("g", "Humidor", { awaiting: true })];
  const r = planAdvance({ cards, cardIds: ["a", "b", "c", "d", "e", "f", "g", "x", "a"], fromStage: "Humidor" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.plan.target, { kind: "stage", stage: "Humidity Press", label: "Humidity Press" });
  assert.deepEqual(r.plan.moves, [{ cardId: "a", stage: "Humidity Press", round: 1, email: true }, { cardId: "b", stage: "Humidity Press", round: 1, email: true }]);
  assert.deepEqual(r.plan.completes, []);
  assert.deepEqual(r.plan.skipped.map((s) => [s.cardId, s.reason, s.current]), [
    ["c", "different_stage", "Book"],
    ["d", "different_stage", null],
    ["e", "refunded", "Humidor"],
    ["f", "done", null],
    ["g", "awaiting_arrival", "Humidor"],
    ["x", "not_on_order", null],
  ]);
});

test("not started -> first step; Final Dry -> completed; a card that is behind moves alone", () => {
  const start = planAdvance({ cards: [card("a", null), card("b", "Humidor")], cardIds: ["a", "b"], fromStage: null });
  assert.ok(start.ok && start.plan.moves.length === 1 && start.plan.moves[0].stage === "Ready for Slab Crack");
  const finish = planAdvance({ cards: [card("a", "Final Dry", { round: 2 }), card("b", "Book with Weights")], cardIds: ["a", "b"], fromStage: "Final Dry" });
  assert.ok(finish.ok);
  if (!finish.ok) return;
  assert.deepEqual(finish.plan.target, { kind: "complete", label: "Done" });
  assert.deepEqual(finish.plan.completes, ["a"]);
  assert.deepEqual(finish.plan.moves, []);
  assert.deepEqual(finish.plan.skipped.map((s) => s.cardId), ["b"]);
  const behind = planAdvance({ cards: [card("b", "Book with Weights")], cardIds: ["b"], fromStage: "Book with Weights" });
  assert.ok(behind.ok && behind.plan.moves[0].stage === "Final Dry");
});

test("toStage jumps (e.g. a raw card skips slab crack); bad stages are refused", () => {
  const r = planAdvance({ cards: [card("a", null)], cardIds: ["a"], fromStage: null, toStage: "Humidor" });
  assert.ok(r.ok && r.plan.moves[0].stage === "Humidor");
  const done = planAdvance({ cards: [card("a", "Clamp Work")], cardIds: ["a"], fromStage: "Clamp Work", toStage: "complete" });
  assert.ok(done.ok && done.plan.completes[0] === "a");
  assert.equal(planAdvance({ cards: [], cardIds: ["a"], fromStage: "Nope" }).ok, false);
  assert.equal(planAdvance({ cards: [], cardIds: ["a"], fromStage: null, toStage: "Nope" }).ok, false);
  assert.equal(planAdvance({ cards: [], cardIds: ["a"], fromStages: { a: "Nope" }, toStage: "Humidor" }).ok, false);
  assert.equal(planAdvance({ cards: [card("a", "Humidor")], cardIds: [], fromStage: "Humidor" }).ok, false);
});

test("any order: a card's step is its newest event; done = steps reached this round, wherever they are", () => {
  // Humidity Press (slab crack and humidor skipped), on to Clamp Work, then back to Humidor
  const events = [stage("a", "Humidity Press"), stage("a", "Clamp Work"), stage("a", "Humidor")];
  const st = cardStageState({ id: "a", completed: false }, newestFirst(events));
  assert.equal(st.current, "Humidor");
  assert.equal(st.currentIndex, 1);
  assert.deepEqual(st.doneStages, ["Humidity Press", "Clamp Work"]);
  assert.deepEqual(st.remainingStages, ["Ready for Slab Crack", "Book", "Heat Press", "Book with Weights", "Final Dry"]);
  assert.equal(st.furthestIndex, 5, "Clamp Work is the furthest it reached");
  assert.deepEqual(st.history.filter((h) => h.kind === "stage").map((h) => h.label), ["Humidity Press", "Clamp Work", "Humidor"]);
});

test("furthest step this round: other cards and earlier rounds don't count", () => {
  const events = [stage("a", "Final Dry", 1), stage("b", "Clamp Work", 2), stage("a", "Humidor", 2), stage("a", "Heat Press", 2), stage("a", "Book", 2)];
  assert.equal(furthestStageIndex("a", 2, events), 4);
  assert.equal(furthestStageIndex("a", 1, events), 7);
  assert.equal(furthestStageIndex("a", 3, events), -1);
  assert.equal(furthestStageIndex("c", 1, events), -1);
  // Old events without metadata ("Stage: <stage> [card:<id>]") are round 1
  const legacy = { event_type: "stage_update", description: "Stage: Heat Press [card:a]", metadata: null, created_at: "2026-11-01T10:00:00Z" };
  assert.equal(furthestStageIndex("a", 1, [legacy]), 4);
});

test("email rule: only a step past the furthest one reached this round emails the customer", () => {
  // Not started yet: any step is news
  assert.equal(stepEmailsCustomer("Ready for Slab Crack", -1), true);
  assert.equal(stepEmailsCustomer("Clamp Work", -1), true, "skipping ahead still emails");
  // Furthest is Clamp Work (5)
  assert.equal(stepEmailsCustomer("Book with Weights", 5), true);
  assert.equal(stepEmailsCustomer("Final Dry", 5), true);
  assert.equal(stepEmailsCustomer("Clamp Work", 5), false, "re-entering the furthest step");
  assert.equal(stepEmailsCustomer("Humidor", 5), false, "going back");
  assert.equal(stepEmailsCustomer("Heat Press", 5), false, "a skipped step behind the furthest is going back too");
  assert.equal(stepEmailsCustomer("Nope", -1), false);
});

test("planAdvance to any step: skip ahead, go back, done from any step; email only past the furthest", () => {
  const cards = [
    card("ahead", null, { furthest: -1 }),
    card("back", "Clamp Work", { furthest: 5 }),
    card("again", "Humidor", { furthest: 5 }), // went back to Humidor, now to Heat Press (still behind Clamp Work)
    card("past", "Humidor", { furthest: 5 }),
  ];
  const plan = (id: string, to: string | "complete", from: string | null) => {
    const r = planAdvance({ cards, cardIds: [id], fromStages: { [id]: from }, toStage: to });
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.ok ? r.plan : null!;
  };
  assert.deepEqual(plan("ahead", "Final Dry", null).moves, [{ cardId: "ahead", stage: "Final Dry", round: 1, email: true }]);
  assert.deepEqual(plan("back", "Humidor", "Clamp Work").moves, [{ cardId: "back", stage: "Humidor", round: 1, email: false }]);
  assert.deepEqual(plan("again", "Heat Press", "Humidor").moves, [{ cardId: "again", stage: "Heat Press", round: 1, email: false }]);
  assert.deepEqual(plan("past", "Book with Weights", "Humidor").moves, [{ cardId: "past", stage: "Book with Weights", round: 1, email: true }]);
  const done = plan("back", "complete", "Clamp Work");
  assert.deepEqual([done.target, done.completes, done.moves], [{ kind: "complete", label: "Done" }, ["back"], []]);
  // Without furthest (older callers) the current step stands in for it
  const r = planAdvance({ cards: [card("x", "Clamp Work")], cardIds: ["x"], fromStage: "Clamp Work", toStage: "Humidor" });
  assert.ok(r.ok && r.plan.moves[0].email === false);
});

test("planAdvance guard: per-card steps; a card moved meanwhile is left alone; already there = no change; the step now is required", () => {
  const cards = [card("a", "Humidor"), card("b", null), card("c", "Book"), card("d", "Clamp Work")];
  const r = planAdvance({
    cards, cardIds: ["a", "b", "c", "d"], toStage: "Clamp Work",
    // c was at Heat Press on the page, but someone moved it to Book since
    fromStages: { a: "Humidor", b: null, c: "Heat Press", d: "Humidor" },
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.plan.moves.map((m) => m.cardId), ["a", "b"]);
  assert.deepEqual(r.plan.skipped.map((s) => [s.cardId, s.reason, s.current]), [
    ["c", "different_stage", "Book"],
    ["d", "already_there", "Clamp Work"],
  ]);
  // The same request again (the cards are there now): nothing to do, nothing refused
  const again = planAdvance({ cards: [card("a", "Clamp Work")], cardIds: ["a"], fromStages: { a: "Humidor" }, toStage: "Clamp Work" });
  assert.ok(again.ok && again.plan.moves.length === 0 && again.plan.skipped[0].reason === "already_there");
  const same = planAdvance({ cards: [card("a", "Humidor")], cardIds: ["a"], fromStage: "Humidor", toStage: "Humidor" });
  assert.ok(same.ok && same.plan.moves.length === 0 && same.plan.skipped[0].reason === "already_there");
  // fromStage covers the cards fromStages doesn't name
  const mixed = planAdvance({ cards, cardIds: ["a", "b"], fromStage: "Humidor", fromStages: { b: null }, toStage: "Final Dry" });
  assert.ok(mixed.ok && mixed.plan.moves.length === 2);
  // A target needs the step every card is at now; the one-tap advance needs fromStage
  assert.equal(planAdvance({ cards, cardIds: ["a"], toStage: "Book" }).ok, false);
  assert.equal(planAdvance({ cards, cardIds: ["a", "b"], fromStages: { a: "Humidor" }, toStage: "Book" }).ok, false);
  assert.equal(planAdvance({ cards, cardIds: ["a"], fromStages: { a: "Humidor" } }).ok, false);
});

test("steps in any order, card by card: Clamp Work, back to Humidor, on to Final Dry (emails: 1st and 3rd)", () => {
  let events: StageEventRow[] = [];
  const emails: string[] = [];
  for (const to of ["Clamp Work", "Humidor", "Final Dry"]) {
    const st = cardStageState({ id: "a", completed: false }, newestFirst(events));
    const r = planAdvance({ cards: [card("a", st.current, { furthest: st.furthestIndex })], cardIds: ["a"], fromStages: { a: st.current }, toStage: to });
    assert.ok(r.ok);
    if (!r.ok) return;
    const [m] = r.plan.moves;
    if (m.email) emails.push(m.stage);
    events = [...events, stage("a", m.stage)];
  }
  assert.equal(cardStageState({ id: "a", completed: false }, newestFirst(events)).current, "Final Dry");
  assert.deepEqual(emails, ["Clamp Work", "Final Dry"]);
});

test("bag completion rule: every non-refunded card done, at least one", () => {
  const done = (completed_at = "2026-12-01T10:00:00Z") => ({ completed: true, completed_at, status: "active" });
  const open = { completed: false, completed_at: null, status: "active" };
  const refunded = { completed: false, completed_at: null, status: "refunded" };
  assert.equal(isBagComplete([done(), done()]), true);
  assert.equal(isBagComplete([done(), open]), false);
  assert.equal(isBagComplete([done(), refunded]), true);
  assert.equal(isBagComplete([refunded]), false);
  assert.equal(isBagComplete([]), false);
});

test("bag completion patch: set to the last card's time, keep the earliest, clear on reopen", () => {
  const now = "2026-12-05T12:00:00.000Z";
  const cards = [
    { completed: true, completed_at: "2026-12-01T10:00:00Z", status: "active" },
    { completed: true, completed_at: "2026-12-03T09:00:00Z", status: "active" },
  ];
  assert.deepEqual(bagCompletionPatch({ completed_at: null }, cards, now), { completed_at: "2026-12-03T09:00:00Z" });
  assert.equal(bagCompletionPatch({ completed_at: "2026-12-03T09:00:00Z" }, cards, now), null);
  assert.deepEqual(bagCompletionPatch({ completed_at: null }, [{ completed: true, completed_at: null, status: "active" }], now), { completed_at: now });
  const reopened = [cards[0], { completed: false, completed_at: null, status: "active" }];
  assert.deepEqual(bagCompletionPatch({ completed_at: "2026-12-03T09:00:00Z" }, reopened, now), { completed_at: null, completion_seen_at: null });
  assert.equal(bagCompletionPatch({ completed_at: null }, reopened, now), null);
});

test("stage groups: not started, steps in order, done; refunded left out", () => {
  const st = (id: string, events: StageEventRow[], completed = false) => cardStageState({ id, completed }, newestFirst(events));
  const groups = stageGroups([
    { id: "a", refunded: false, stage: st("a", [stage("a", "Book")]) },
    { id: "b", refunded: false, stage: st("b", [], true) },
    { id: "c", refunded: false, stage: st("c", []) },
    { id: "d", refunded: false, stage: st("d", [stage("d", "Humidor")]) },
    { id: "e", refunded: false, stage: st("e", [stage("e", "Book")]) },
    { id: "f", refunded: true, stage: st("f", [stage("f", "Book")]) },
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.label, g.cardIds]), [
    ["not_started", "Not started", ["c"]],
    ["Humidor", "Humidor", ["d"]],
    ["Book", "Drying", ["a", "e"]],
    ["done", "Done", ["b"]],
  ]);
});
