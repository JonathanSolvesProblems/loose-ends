// Extractor tests. The LlmExtractor is exercised with a stub classifier (no
// network), which lets us prove the deterministic noise gate short-circuits
// before any model call and that ownership is assigned correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HeuristicExtractor, LlmExtractor, preFilter, isSoftNoise } from "../src/extractor.ts";
import type { LlmClassifier, Classification, Fulfillment } from "../src/llm.ts";
import type { IncomingMessage } from "../src/types.ts";

const msg = (text: string, userId = "U_ALICE"): IncomingMessage => ({
  channelId: "C1", ts: "1", userId, text, observedAt: 0,
});

class StubClassifier implements LlmClassifier {
  public calls = 0;
  private readonly result: Classification;
  constructor(result: Classification) {
    this.result = result;
  }
  async classify(): Promise<Classification> {
    this.calls++;
    return this.result;
  }
  async confirmsFulfillment(): Promise<Fulfillment> {
    return { fulfilled: false, confidence: 0 };
  }
}

test("preFilter separates requests, commitments, and noise", () => {
  assert.deepEqual(preFilter("Can someone follow up with the family?"), { match: true, kind: "request" });
  assert.deepEqual(preFilter("I'll file the report by Friday"), { match: true, kind: "commitment" });
  assert.deepEqual(preFilter("we should grab lunch sometime"), { match: false });
});

test("isSoftNoise catches obvious social filler", () => {
  assert.equal(isSoftNoise("we should grab lunch sometime"), true);
  assert.equal(isSoftNoise("I'll think about it, no rush"), true);
  assert.equal(isSoftNoise("Can someone take the intake call?"), false);
});

test("HeuristicExtractor assigns ownership by kind", async () => {
  const ex = new HeuristicExtractor();
  const req = await ex.extract(msg("Can someone follow up with the Diaz family?"));
  assert.equal(req?.kind, "request");
  assert.equal(req?.ownerId, null, "an unowned request has no owner");

  const com = await ex.extract(msg("I'll get the grant report to the funder by Friday.", "U_ALICE"));
  assert.equal(com?.kind, "commitment");
  assert.equal(com?.ownerId, "U_ALICE", "a commitment is owned by its author");
  assert.ok(com?.dueAt, "the Friday deadline is grounded to an instant");

  assert.equal(await ex.extract(msg("we should grab lunch sometime")), null);
});

test("LlmExtractor never calls the model on soft noise (deterministic negative control)", async () => {
  const stub = new StubClassifier({ kind: "request", summary: "x", owner: "", dueText: "", confidence: 0.9 });
  const ex = new LlmExtractor(stub);
  assert.equal(await ex.extract(msg("we should grab lunch sometime")), null);
  assert.equal(stub.calls, 0, "the noise gate short-circuits before any token is spent");
});

test("LlmExtractor builds a loop from the classification and assigns ownership", async () => {
  const reqStub = new StubClassifier({ kind: "request", summary: "follow up with the Diaz family", owner: "", dueText: "", confidence: 0.9 });
  const req = await new LlmExtractor(reqStub).extract(msg("The Diaz family still hasn't heard back."));
  assert.equal(req?.kind, "request");
  assert.equal(req?.ownerId, null);

  const comStub = new StubClassifier({ kind: "commitment", summary: "send the grant report", owner: "", dueText: "by Friday", confidence: 0.9 });
  const com = await new LlmExtractor(comStub).extract(msg("Sending the grant report this afternoon.", "U_BOB"));
  assert.equal(com?.kind, "commitment");
  assert.equal(com?.ownerId, "U_BOB");
});

test("a deadline is grounded in the author's timezone, not the server's", async () => {
  // "by 2am" said by someone in US Eastern (UTC-4) must resolve to 2am THEIR time
  // (06:00 UTC), not 2am UTC. This is the bug that rendered "Due Yesterday 10PM".
  const anchor = Date.UTC(2023, 10, 14, 12, 0); // noon UTC
  const eastern: IncomingMessage = {
    channelId: "C1", ts: "1", userId: "U_A", text: "I'll file the report by 2am", observedAt: anchor, tzOffsetMinutes: -240,
  };
  const utc: IncomingMessage = { ...eastern, tzOffsetMinutes: 0 };

  const ex = new HeuristicExtractor(0); // server default is UTC; the message wins
  const easternDue = (await ex.extract(eastern))!.dueAt!;
  const utcDue = (await ex.extract(utc))!.dueAt!;

  assert.equal(new Date(easternDue).getUTCHours(), 6, "2am EDT is 06:00 UTC");
  assert.equal(new Date(utcDue).getUTCHours(), 2, "2am UTC is 02:00 UTC");
  assert.equal(easternDue - utcDue, 4 * 60 * 60 * 1000, "exactly the 4h offset");
});

test("LlmExtractor drops 'none' and low-confidence classifications", async () => {
  const none = new StubClassifier({ kind: "none", summary: "", owner: "", dueText: "", confidence: 0.9 });
  assert.equal(await new LlmExtractor(none).extract(msg("thanks team, great week")), null);

  const low = new StubClassifier({ kind: "request", summary: "maybe", owner: "", dueText: "", confidence: 0.2 });
  assert.equal(await new LlmExtractor(low).extract(msg("might need someone eventually")), null);
});
