/** Per-card steps, bulk advance planning and bag completion (lib/intake/stage-plan.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "@/lib/restoration-stages";
import {
  bagCompletionPatch, cardStageState, isBagComplete, nextStepAfter, planAdvance, stageGroups, type AdvanceCard,
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
  assert.deepEqual(atFinal.remainingStages, []);
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
  assert.deepEqual(r.plan.moves, [{ cardId: "a", stage: "Humidity Press", round: 1 }, { cardId: "b", stage: "Humidity Press", round: 1 }]);
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
  assert.equal(planAdvance({ cards: [card("a", "Humidor")], cardIds: ["a"], fromStage: "Humidor", toStage: "Humidor" }).ok, false);
  assert.equal(planAdvance({ cards: [card("a", "Humidor")], cardIds: [], fromStage: "Humidor" }).ok, false);
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
