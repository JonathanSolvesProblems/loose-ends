// The deterministic ledger is the moat, so it gets the most tests. Every case
// passes `now` explicitly, so the whole lifecycle is reproducible with no clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, type LedgerConfig } from "../src/ledger.ts";
import type { ExtractedLoop, MessageRef } from "../src/types.ts";

const CFG: LedgerConfig = {
  responseSlaMs: 1000,
  graceMs: 1000,
  escalationGraceMs: 1000,
  minConfidence: 0.6,
};

const src = (ts: string): MessageRef => ({ channelId: "C1", ts });
const request = (conf = 0.8): ExtractedLoop => ({ kind: "request", summary: "follow up with the Diaz family", ownerId: null, dueAt: null, confidence: conf });
const commitment = (dueAt: number | null, conf = 0.8): ExtractedLoop => ({ kind: "commitment", summary: "file the report", ownerId: "U_ALICE", dueAt, confidence: conf });

test("a request with no owner starts UNOWNED; a commitment starts CLAIMED", () => {
  const l = new Ledger(CFG);
  assert.equal(l.admit(request(), src("1"), 0)?.status, "UNOWNED");
  assert.equal(l.admit(commitment(null), src("2"), 0)?.status, "CLAIMED");
});

test("low-confidence extractions are rejected", () => {
  const l = new Ledger(CFG);
  assert.equal(l.admit(request(0.4), src("1"), 0), null);
  assert.equal(l.all().length, 0);
});

test("the same source message is never double-tracked", () => {
  const l = new Ledger(CFG);
  assert.ok(l.admit(request(), src("1"), 0));
  assert.equal(l.admit(request(), src("1"), 0), null);
  assert.equal(l.all().length, 1);
});

test("an unclaimed request escalates once the response SLA passes", () => {
  const l = new Ledger(CFG);
  l.admit(request(), src("1"), 0);
  assert.equal(l.tick(500).length, 0, "no change before the SLA");
  const changed = l.tick(1000);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].status, "ESCALATED");
});

test("claiming an unowned request stops the escalation", () => {
  const l = new Ledger(CFG);
  l.admit(request(), src("1"), 0);
  l.claim("C1:1", "U_BACKUP", 500);
  assert.equal(l.get("C1:1")?.status, "CLAIMED");
  assert.equal(l.get("C1:1")?.ownerId, "U_BACKUP");
  assert.equal(l.tick(2000).length, 0, "a claimed request with no deadline never times out");
});

test("a commitment runs CLAIMED -> DUE -> ESCALATED, then BROKEN on a later tick", () => {
  const l = new Ledger(CFG);
  l.admit(commitment(1000), src("1"), 0); // due at t=1000
  // One tick past deadline+grace crosses CLAIMED -> DUE -> ESCALATED at once;
  // escalatedAt is stamped at this tick, so BROKEN needs a later tick (which is
  // exactly what lets the demo stage the escalation before the break).
  const first = l.tick(2001);
  assert.equal(first[0].status, "ESCALATED");
  const second = l.tick(2001 + 1001);
  assert.equal(second[0].status, "BROKEN");
  const kinds = l.get("C1:1")!.history.map((h) => h.to);
  assert.deepEqual(kinds, ["CLAIMED", "DUE", "ESCALATED", "BROKEN"]);
});

test("fulfillment is terminal and beats the timer", () => {
  const l = new Ledger(CFG);
  l.admit(commitment(1000), src("1"), 0);
  l.markFulfilled("C1:1", 500);
  assert.equal(l.get("C1:1")?.status, "FULFILLED");
  assert.equal(l.tick(1_000_000).length, 0, "a fulfilled loop never re-opens on a timer");
});

test("dismiss and snooze behave as designed", () => {
  const l = new Ledger(CFG);
  l.admit(request(), src("1"), 0);
  // Snooze until 500, still inside the 1000ms response SLA, so it reopens cleanly
  // as UNOWNED rather than immediately re-escalating.
  l.snooze("C1:1", 500, 0);
  assert.equal(l.get("C1:1")?.status, "SNOOZED");
  assert.equal(l.tick(400).length, 0, "stays snoozed until snoozeUntil");
  const reopened = l.tick(600);
  assert.equal(reopened[0].status, "UNOWNED", "an unowned request reopens UNOWNED");

  l.admit(commitment(null), src("2"), 0);
  l.dismiss("C1:2", 0);
  assert.equal(l.get("C1:2")?.status, "DISMISSED");
});

test("every transition is recorded in the audit history", () => {
  const l = new Ledger(CFG);
  l.admit(request(), src("1"), 0);
  l.tick(1000); // -> ESCALATED
  const h = l.get("C1:1")!.history;
  assert.equal(h[0].to, "UNOWNED");
  assert.equal(h[0].reason, "admitted");
  assert.ok(h.some((e) => e.to === "ESCALATED"));
});
