// The gate in front of the evidence verifier decides which messages the model is
// even allowed to judge. Gating a real completion OUT is the expensive mistake:
// the loop then nags someone who already did the work. Gating a non-completion IN
// costs one token and the model rejects it. So the gate is deliberately generous.

import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeCompletion, sharesSubject, isWorthChecking, FulfillmentDetector } from "../src/fulfillment.ts";
import type { LlmClassifier, Classification, Fulfillment } from "../src/llm.ts";

const DIAZ = "follow up with the Diaz family about their housing application";

test("obvious completion phrasing is caught by the keyword signal", () => {
  assert.equal(looksLikeCompletion("closed out the Diaz housing case"), true);
  assert.equal(looksLikeCompletion("report sent to the funder"), true);
  assert.equal(looksLikeCompletion("we should grab lunch sometime"), false);
});

test("oblique completions are admitted by subject overlap, not keywords", () => {
  // The real bug this fixes: a keyword-only gate threw these away before the
  // model could ever see them.
  const oblique = "the Diaz family has their voucher now";
  assert.equal(looksLikeCompletion(oblique), false, "no completion keyword");
  assert.equal(sharesSubject(DIAZ, oblique), true, "but it is about the same work");
  assert.equal(isWorthChecking(DIAZ, oblique), true);

  const inbox = "budget draft is in your inbox";
  assert.equal(looksLikeCompletion(inbox), false);
  assert.equal(isWorthChecking("deliver the budget draft", inbox), true);
});

test("subject overlap tolerates simple word endings", () => {
  assert.equal(sharesSubject("onboard this week's volunteers", "all six volunteers are onboarded"), true);
  assert.equal(sharesSubject("confirm the phone number for the Alvarez family", "Alvarez number confirmed"), true);
});

test("unrelated chatter is not worth a model call", () => {
  assert.equal(isWorthChecking(DIAZ, "the deploy pipeline is red again"), false);
  assert.equal(isWorthChecking("call the shelter about the pantry", "anyone seen my headphones"), false);
});

test("the model, not the gate, is the precision layer", async () => {
  // "closed out the Ramirez case" passes the keyword gate but is about different
  // work. The gate lets it through; the model must be the one to reject it.
  const ramirez = "closed out the Ramirez case, they got the voucher";
  assert.equal(isWorthChecking(DIAZ, ramirez), true, "gate is generous");

  class Rejecting implements LlmClassifier {
    async classify(): Promise<Classification> {
      return { kind: "none", summary: "", owner: "", dueText: "", confidence: 0 };
    }
    async confirmsFulfillment(): Promise<Fulfillment> {
      return { fulfilled: false, confidence: 0.9 };
    }
  }
  assert.equal(await new FulfillmentDetector(new Rejecting()).isEvidenceOfFulfillment(DIAZ, ramirez), false);
});

test("low model confidence never closes a loop", async () => {
  class Unsure implements LlmClassifier {
    async classify(): Promise<Classification> {
      return { kind: "none", summary: "", owner: "", dueText: "", confidence: 0 };
    }
    async confirmsFulfillment(): Promise<Fulfillment> {
      return { fulfilled: true, confidence: 0.3 };
    }
  }
  const d = new FulfillmentDetector(new Unsure(), 0.6);
  assert.equal(await d.isEvidenceOfFulfillment(DIAZ, "closed out the Diaz case"), false);
});
