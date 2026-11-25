/** The step picker's logic (lib/intake/step-picker.ts): chips, the request it sends, Done's confirm, the line after a tap. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "@/lib/restoration-stages";
import { stageGroups, cardStageState } from "@/lib/intake/stage-plan";
import {
  DONE_TARGET, groupPickerCards, pickerChips, pickerNeedsConfirm, pickerOutcome, pickerRequest, type PickerCard,
} from "@/lib/intake/step-picker";

test("chips: all 8 steps in order with their admin names, then Done; one card's step highlighted, reached steps checked", () => {
  const chips = pickerChips([{ id: "a", current: "Humidor" }], ["Clamp Work"]);
  assert.deepEqual(chips.map((c) => [c.target, c.number, c.label]), [
    ["Ready for Slab Crack", 1, "Ready for Slab Crack"], ["Humidor", 2, "Humidor"], ["Humidity Press", 3, "Humidity Press"],
    ["Book", 4, "Drying"], ["Heat Press", 5, "Heat Press"], ["Clamp Work", 6, "Clamp Work"], ["Book with Weights", 7, "Book with Weights"],
    ["Final Dry", 8, "Final Dry"], [DONE_TARGET, null, "Done"],
  ]);
  assert.deepEqual(chips.filter((c) => c.current).map((c) => c.target), ["Humidor"]);
  assert.deepEqual(chips.filter((c) => c.reached).map((c) => c.target), ["Clamp Work"]);
  // Not started: nothing highlighted; done: Done highlighted
  assert.equal(pickerChips([{ id: "a", current: null }]).some((c) => c.current), false);
  assert.deepEqual(pickerChips([{ id: "a", current: null, completed: true }]).filter((c) => c.current).map((c) => c.target), [DONE_TARGET]);
  // The current step is never also "reached"
  assert.equal(pickerChips([{ id: "a", current: "Humidor" }], ["Humidor"])[1].reached, false);
});

test("chips for a bag: counts per step; highlighted only when every card is there", () => {
  const cards: PickerCard[] = [
    { id: "a", current: "Humidor" }, { id: "b", current: "Humidor" }, { id: "c", current: null }, { id: "d", current: null, completed: true },
  ];
  const chips = pickerChips(cards);
  assert.deepEqual(chips.filter((c) => c.count).map((c) => [c.target, c.count]), [["Humidor", 2], [DONE_TARGET, 1]]);
  assert.equal(chips.some((c) => c.current), false);
  const same = pickerChips([{ id: "a", current: "Book" }, { id: "b", current: "Book" }]);
  assert.deepEqual(same.filter((c) => c.current).map((c) => c.label), ["Drying"]);
});

test("request: every card not done and not there yet, each with the step the page shows (the route's guard)", () => {
  const cards: PickerCard[] = [{ id: "a", current: "Clamp Work" }, { id: "b", current: "Humidor" }, { id: "c", current: null }, { id: "d", current: "Final Dry", completed: true }];
  // Going back is a plain request like any other
  assert.deepEqual(pickerRequest("o1", cards, "Humidor"), {
    orderId: "o1", cardIds: ["a", "c"], toStage: "Humidor", fromStages: { a: "Clamp Work", c: null },
  });
  assert.deepEqual(pickerRequest("o1", cards, DONE_TARGET), {
    orderId: "o1", cardIds: ["a", "b", "c"], toStage: DONE_TARGET, fromStages: { a: "Clamp Work", b: "Humidor", c: null },
  });
  assert.equal(pickerRequest("o1", [{ id: "a", current: "Humidor" }], "Humidor"), null, "already there: nothing to send");
  assert.equal(pickerRequest("o1", [{ id: "a", current: null, completed: true }], "Humidor"), null, "a done card is left alone");
});

test("Done asks once more only for several cards", () => {
  assert.equal(pickerNeedsConfirm(DONE_TARGET, [{ id: "a", current: "Final Dry" }]), false);
  assert.equal(pickerNeedsConfirm(DONE_TARGET, [{ id: "a", current: "Final Dry" }, { id: "b", current: null }]), true);
  assert.equal(pickerNeedsConfirm(DONE_TARGET, [{ id: "a", current: "Final Dry" }, { id: "b", current: null, completed: true }]), false);
  assert.equal(pickerNeedsConfirm("Humidor", [{ id: "a", current: null }, { id: "b", current: null }]), false);
});

test("the line after a tap: moved, emailed or not, done, left alone", () => {
  assert.deepEqual(pickerOutcome("Clamp Work", 1, { moved: ["a"], newStep: ["a"], skipped: [], emailed: true }), { tone: "ok", text: "Now at Clamp Work. Customer emailed." });
  assert.deepEqual(pickerOutcome("Humidor", 1, { moved: ["a"], newStep: [], skipped: [], emailed: false }), {
    tone: "ok", text: "Now at Humidor. No customer email: they already heard about this step or a later one.",
  });
  assert.deepEqual(pickerOutcome("Book", 3, { moved: ["a", "b", "c"], newStep: ["c"], skipped: [], emailed: true }), {
    tone: "ok", text: "3 cards moved to Drying. Customer emailed about 1 of them.",
  });
  assert.deepEqual(pickerOutcome(DONE_TARGET, 1, { moved: ["a"], skipped: [], emailed: false }), { tone: "ok", text: "Marked done." });
  assert.deepEqual(pickerOutcome(DONE_TARGET, 4, { moved: ["a", "b", "c"], skipped: [{ reason: "done" }] }), { tone: "ok", text: "3 cards marked done. 1 already done." });
  assert.deepEqual(pickerOutcome("Humidor", 1, { moved: [], skipped: [{ reason: "already_there" }] }), { tone: "ok", text: "Already at Humidor." });
  assert.deepEqual(pickerOutcome("Humidor", 1, { moved: [], skipped: [{ reason: "different_stage" }] }), {
    tone: "warn", text: "Nothing changed: the step was changed on another screen just now. The page now shows where things are.",
  });
  assert.deepEqual(pickerOutcome("Final Dry", 3, { moved: ["a"], newStep: ["a"], skipped: [{ reason: "different_stage" }, { reason: "already_there" }], emailed: true }), {
    tone: "warn", text: "1 card moved to Final Dry. Customer emailed. 1 card was moved on another screen just now and left alone. 1 already at Final Dry.",
  });
  assert.equal(pickerOutcome("Humidor", 2, { moved: [], skipped: [{ reason: "awaiting_arrival" }, { reason: "refunded" }] }).text, "1 card not received yet. 1 card refunded.");
});

test("a bag's picker cards from its step groups (the Bags board)", () => {
  const ev = (id: string, s: string) => ({ event_type: "stage_update", description: `Stage: ${s} [card:${id}]`, metadata: { card_id: id, stage: s, round: 1 }, created_at: "2026-11-25T10:00:00Z" });
  const groups = stageGroups([
    { id: "a", refunded: false, stage: cardStageState({ id: "a", completed: false }, [ev("a", "Humidor")]) },
    { id: "b", refunded: false, stage: cardStageState({ id: "b", completed: true }, []) },
    { id: "c", refunded: false, stage: cardStageState({ id: "c", completed: false }, []) },
    { id: "d", refunded: true, stage: cardStageState({ id: "d", completed: false }, []) },
  ]);
  assert.deepEqual(groupPickerCards(groups), [
    { id: "c", current: null, completed: false }, { id: "a", current: "Humidor", completed: false }, { id: "b", current: null, completed: true },
  ]);
  assert.equal(STAGES.length, 8);
});
