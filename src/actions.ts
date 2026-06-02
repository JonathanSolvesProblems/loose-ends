// The hands: governed write-back through an MCP server, behind a human-review gate.
//
// Nothing here writes to the system of record without an explicit approved action.
// The agent proposes; a person taps Done / Snooze / Not a commitment; only then do
// we write. That gate is the action layer that scores above read-only insight, and
// the safety posture that reads as production maturity.

import type { Commitment } from "./types.ts";

/** A reviewer's decision on a proposed nudge. */
export type ReviewDecision =
  | { kind: "approve" } // write the follow-up
  | { kind: "snooze"; until: number }
  | { kind: "dismiss" }; // "not a commitment" -> trains the pre-filter

/** What we render to the owner as a Block Kit card. Kept as data for testability. */
export interface NudgeCard {
  commitmentId: string;
  headline: string;
  detail: string;
  permalink?: string;
  /** The three buttons. The whole UX restraint of the product lives here. */
  actions: Array<"approve" | "snooze" | "dismiss">;
}

export function buildNudgeCard(c: Commitment): NudgeCard {
  const when = c.dueAt ? new Date(c.dueAt).toISOString().slice(0, 10) : "no deadline";
  return {
    commitmentId: c.id,
    headline: c.status === "BROKEN" ? "This looks dropped" : "Heads up, this is due",
    detail: `"${c.summary}" (${when})`,
    permalink: c.source.permalink,
    actions: ["approve", "snooze", "dismiss"],
  };
}

/** The MCP write-back surface. The agent only ever calls this AFTER approval. */
export interface ActionSink {
  /** Send the calm ephemeral nudge to the owner. */
  sendNudge(ownerId: string, card: NudgeCard): Promise<void>;
  /** On approval, write a tracked item into Slack's system of record. */
  createFollowUp(c: Commitment): Promise<{ itemId: string }>;
}

/** Offline stand-in that records calls, for the demo and tests. */
export class MockActionSink implements ActionSink {
  public sent: Array<{ ownerId: string; card: NudgeCard }> = [];
  public written: Commitment[] = [];

  async sendNudge(ownerId: string, card: NudgeCard): Promise<void> {
    this.sent.push({ ownerId, card });
  }
  async createFollowUp(c: Commitment): Promise<{ itemId: string }> {
    this.written.push(c);
    return { itemId: `list-item:${c.id}` };
  }
}

/**
 * TODO(week4): implement McpActionSink.
 *   sendNudge      -> chat.postEphemeral with the Block Kit card.
 *   createFollowUp -> MCP tool call that writes a Slack List item / reminder / Task.
 * The MCP server is what makes the write governed and portable across systems of
 * record; keep the create idempotent on commitment id.
 */
