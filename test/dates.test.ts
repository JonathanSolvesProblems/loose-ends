// Deadline grounding must be deterministic and phrase-accurate (the old stub
// mapped every phrase to +3 days, which broke the demo). Anchored to a fixed
// Tuesday so results are reproducible with no clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groundDeadline } from "../src/dates.ts";

const ANCHOR = Date.UTC(2023, 10, 14, 12, 0); // Tue 2023-11-14 12:00 UTC
const dow = (ms: number) => new Date(ms).getUTCDay();
const day = (ms: number) => new Date(ms).getUTCDate();

test("'by Friday' resolves to the coming Friday, after the anchor", () => {
  const d = groundDeadline("get it done by Friday", ANCHOR, 0);
  assert.ok(d && d > ANCHOR);
  assert.equal(dow(d!), 5, "Friday");
  assert.equal(day(d!), 17);
});

test("'tomorrow' is the next calendar day", () => {
  const d = groundDeadline("I'll call them tomorrow", ANCHOR, 0);
  assert.equal(day(d!), 15);
});

test("'EOD' is later the same day", () => {
  const d = groundDeadline("send it by EOD", ANCHOR, 0);
  assert.ok(d && d > ANCHOR);
  assert.equal(day(d!), 14, "same day");
});

test("'next week' is strictly later than this Friday", () => {
  const friday = groundDeadline("by Friday", ANCHOR, 0)!;
  const nextWeek = groundDeadline("some time next week", ANCHOR, 0)!;
  assert.ok(nextWeek > friday);
});

test("'in 2 days' adds two days", () => {
  const d = groundDeadline("in 2 days", ANCHOR, 0);
  assert.equal(day(d!), 16);
});

test("a message with no deadline grounds to null", () => {
  assert.equal(groundDeadline("can someone follow up with the family?", ANCHOR, 0), null);
});

test("'by Friday' and 'tomorrow' resolve to DIFFERENT instants (the old-stub bug)", () => {
  const friday = groundDeadline("by Friday", ANCHOR, 0);
  const tomorrow = groundDeadline("tomorrow", ANCHOR, 0);
  assert.notEqual(friday, tomorrow);
});
