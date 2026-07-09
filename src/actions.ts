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

import type { Loop, LoopStatus } from "./types.ts";

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
  /** Why the agent spoke up. Rendered small, under the headline. Never make the
   *  human guess what the bot noticed or why it is bothering them. */
  reason: string;
  ownerId: string | null;
  dueAt: number | null;
  status: LoopStatus;
  permalink?: string;
  /** The buttons offered. The UX restraint of the product lives here. */
  actions: Array<"claim" | "approve" | "snooze" | "dismiss">;
}

export function buildCard(loop: Loop): LoopCard {
  const base = {
    loopId: loop.id,
    ownerId: loop.ownerId,
    dueAt: loop.dueAt,
    status: loop.status,
    permalink: loop.source.permalink,
    detail: `"${loop.summary}"`,
  };
  const needsOwner = loop.status === "UNOWNED" || (loop.status === "ESCALATED" && !loop.ownerId);

  if (needsOwner) {
    const escalated = loop.status === "ESCALATED";
    return {
      ...base,
      audience: "coordinator",
      headline: escalated ? "Nobody has picked this up" : "This needs an owner",
      reason: escalated
        ? "The response window passed and nobody claimed this. Escalating to a backup human so it doesn't get dropped."
        : "Someone asked for this, but nobody has taken it yet.",
      actions: ["claim", "snooze", "dismiss"],
    };
  }

  const escalated = loop.status === "ESCALATED";
  return {
    ...base,
    audience: escalated ? "coordinator" : "owner",
    headline: escalated ? "Past due, and no proof it happened" : "This is coming due",
    reason: escalated
      ? "The deadline and grace period both passed, and I haven't seen a single message showing this work actually landed."
      : "The deadline is here. Mark it done once the work is genuinely finished.",
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
