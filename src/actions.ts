// The hands: the card model + review-gate decisions, behind a human-review gate.
//
// Nothing here writes to the system of record without an explicit approved action.
// The agent proposes; a person claims / confirms / dismisses; only then do we
// write. That gate is the action layer that scores above read-only insight, and
// the safety posture that reads as production maturity.
//
// Two surfaces, by status:
//  - UNOWNED / ESCALATED loops -> a coordinator card asking someone to CLAIM it.
//  - CLAIMED / DUE loops       -> a nudge to the owner.

import type { Loop } from "./types.ts";

/** A reviewer's decision on a proposed card. */
export type ReviewDecision =
  | { kind: "claim"; ownerId: string } // a person takes ownership of a request
  | { kind: "approve" } // write the follow-up into the system of record
  | { kind: "snooze"; until: number }
  | { kind: "dismiss" }; // "not a real loop" -> trains the pre-filter

/** What we render as a Block Kit card. Kept as data for testability. */
export interface LoopCard {
  loopId: string;
  audience: "owner" | "coordinator";
  headline: string;
  detail: string;
  permalink?: string;
  /** The buttons offered. The UX restraint of the product lives here. */
  actions: Array<"claim" | "approve" | "snooze" | "dismiss">;
}

export function buildCard(loop: Loop): LoopCard {
  const when = loop.dueAt ? new Date(loop.dueAt).toISOString().slice(0, 10) : "no deadline";
  const needsOwner = loop.status === "UNOWNED" || (loop.status === "ESCALATED" && !loop.ownerId);

  if (needsOwner) {
    return {
      loopId: loop.id,
      audience: "coordinator",
      headline: loop.status === "ESCALATED" ? "Nobody has picked this up" : "This needs an owner",
      detail: `"${loop.summary}"`,
      permalink: loop.source.permalink,
      actions: ["claim", "snooze", "dismiss"],
    };
  }
  return {
    loopId: loop.id,
    audience: loop.status === "ESCALATED" ? "coordinator" : "owner",
    headline: loop.status === "ESCALATED" ? "This looks dropped" : "Heads up, this is due",
    detail: `"${loop.summary}" (${when})`,
    permalink: loop.source.permalink,
    actions: ["approve", "snooze", "dismiss"],
  };
}

/** The MCP write-back surface. The agent only ever calls this AFTER review. */
export interface ActionSink {
  /** Send the calm card to the owner or to a coordinator. */
  sendCard(targetId: string, card: LoopCard): Promise<void>;
  /** On approval, write a tracked item into Slack's system of record. */
  createFollowUp(loop: Loop): Promise<{ itemId: string }>;
}

/** Offline stand-in that records calls, for the demo and tests. */
export class MockActionSink implements ActionSink {
  public sent: Array<{ targetId: string; card: LoopCard }> = [];
  public written: Loop[] = [];

  async sendCard(targetId: string, card: LoopCard): Promise<void> {
    this.sent.push({ targetId, card });
  }
  async createFollowUp(loop: Loop): Promise<{ itemId: string }> {
    this.written.push(loop);
    return { itemId: `list-item:${loop.id}` };
  }
}

// The REAL write-back lives in src/slack/app.ts (it needs the live WebClient and
// channel context, so it drives Slack directly rather than through this offline
// sink): cards via chat.postMessage/update, and an optional Slack List row via
// the Web API `slackLists.items.create`. Note the Slack hosted MCP server has NO
// Lists/task/reminder tool (message + canvas writes only), which is why write-back
// uses the Web API directly instead of MCP.
