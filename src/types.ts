// Core domain types for Loose Ends.
//
// Loose Ends is an org-level coverage-gap safety net for mission-driven Slack
// workspaces. It tracks "open loops": work that was asked for or promised in a
// channel and could fall through the cracks. The novel target (vs existing
// commitment bots) is the UNOWNED request: something asked that nobody has
// claimed yet. Those are the ones that drop silently.
//
// This file is platform-agnostic on purpose. The Slack/RTS/MCP adapters depend
// on these types, never the other way around.

/**
 * Where a candidate loop came from. Keeping the raw coordinates lets the ledger
 * dedupe, lets the reviewer jump back to the source, and gives the demo an audit
 * trail.
 */
export interface MessageRef {
  channelId: string;
  ts: string; // Slack message timestamp, also the stable message id
  threadTs?: string;
  permalink?: string;
}

/** A message as the watcher hands it to the extractor. */
export interface IncomingMessage extends MessageRef {
  userId: string;
  text: string;
  /** Epoch ms. Passed in explicitly so the core never calls Date.now() itself. */
  observedAt: number;
  /**
   * The author's UTC offset in minutes, when known. "by 2am" means 2am in the
   * timezone of the person who said it, not in UTC. Falls back to the workspace
   * default when absent.
   */
  tzOffsetMinutes?: number;
}

/**
 * What kind of open loop this is.
 *  - "request":    someone asked for something ("can someone follow up with the
 *                  Diaz family?"). May be unowned. This is the un-cloned target.
 *  - "commitment": someone promised to do something ("I'll call them tomorrow").
 *                  Always has an owner.
 */
export type LoopKind = "request" | "commitment";

/**
 * The deterministic lifecycle. Transitions are the moat: reproducible and
 * auditable, independent of what the LLM said.
 *
 *   UNOWNED   ──(claimed by a person)──────────────> CLAIMED
 *   UNOWNED   ──(response SLA passes, still unowned)─> ESCALATED   (ping a coordinator)
 *   CLAIMED   ──(deadline passes)───────────────────> DUE
 *   DUE       ──(grace passes)──────────────────────> ESCALATED
 *   ESCALATED ──(escalation grace passes)───────────> BROKEN
 *   any       ──(fulfillment detected / marked done)─> FULFILLED
 *   any       ──(reviewer: not a real loop)──────────> DISMISSED
 *   any       ──(snoozed)────────────────────────────> SNOOZED ──(snooze ends)──> UNOWNED|CLAIMED
 */
export type LoopStatus =
  | "UNOWNED"
  | "CLAIMED"
  | "DUE"
  | "ESCALATED"
  | "BROKEN"
  | "FULFILLED"
  | "SNOOZED"
  | "DISMISSED";

/** What the extractor produces from a single message. */
export interface ExtractedLoop {
  kind: LoopKind;
  /** Normalized to a short imperative ("follow up with the Diaz family"). */
  summary: string;
  /** Slack user id of the owner, or null for an unclaimed request. */
  ownerId: string | null;
  /** Epoch ms the thing is due, or null if no deadline could be grounded. */
  dueAt: number | null;
  /** 0..1 model confidence this is a real, actionable open loop. */
  confidence: number;
}

/** A tracked open loop as it lives in the ledger. */
export interface Loop extends ExtractedLoop {
  id: string;
  status: LoopStatus;
  source: MessageRef;
  createdAt: number;
  updatedAt: number;
  /** Set when the loop is escalated; drives the ESCALATED -> BROKEN timer. */
  escalatedAt?: number;
  /** Set when SNOOZED: epoch ms to reopen. */
  snoozeUntil?: number;
  /** Audit log of every transition, oldest first. */
  history: Array<{ at: number; from: LoopStatus | null; to: LoopStatus; reason: string }>;
}

/** A single labeled example in the evaluation corpus. */
export interface CorpusRow {
  text: string;
  /** Ground truth: is this an actionable open loop the agent should track? */
  isOpenLoop: boolean;
  /** Expected kind when isOpenLoop is true (for richer scoring). */
  kind?: LoopKind;
  note?: string;
}
