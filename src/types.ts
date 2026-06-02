// Core domain types for Loose Ends.
// This file is platform-agnostic on purpose: it describes commitments and their
// lifecycle, not Slack. The Slack/RTS/MCP adapters depend on these types, never
// the other way around.

/**
 * Where a candidate commitment came from. Keeping the raw coordinates lets the
 * ledger dedupe, lets the reviewer jump back to the source, and gives the demo
 * an audit trail.
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
}

/**
 * The deterministic lifecycle. Transitions are the moat: they are reproducible
 * and auditable, independent of what the LLM said.
 *
 *   OPEN ──(deadline passes, no fulfillment)──> DUE
 *   DUE  ──(grace period passes)──────────────> BROKEN
 *   any  ──(fulfillment detected / user marks)─> FULFILLED
 *   any  ──(user: "not a commitment")──────────> DISMISSED
 *   any  ──(user snoozes)──────────────────────> SNOOZED ──(snooze ends)──> OPEN
 */
export type CommitmentStatus =
  | "OPEN"
  | "DUE"
  | "BROKEN"
  | "FULFILLED"
  | "SNOOZED"
  | "DISMISSED";

/** What the extractor produces from a single message. */
export interface ExtractedCommitment {
  /** The promise, normalized to a short imperative ("send the grant report"). */
  summary: string;
  /** Slack user id of who owes it. */
  ownerId: string;
  /** Epoch ms the thing is due, or null if no deadline could be grounded. */
  dueAt: number | null;
  /** 0..1 model confidence this is a real, actionable commitment. */
  confidence: number;
}

/** A tracked commitment as it lives in the ledger. */
export interface Commitment extends ExtractedCommitment {
  id: string;
  status: CommitmentStatus;
  source: MessageRef;
  createdAt: number;
  updatedAt: number;
  /** Set when SNOOZED: epoch ms to reopen. */
  snoozeUntil?: number;
  /** Audit log of every transition, oldest first. */
  history: Array<{ at: number; from: CommitmentStatus | null; to: CommitmentStatus; reason: string }>;
}

/** A single labeled example in the evaluation corpus. */
export interface CorpusRow {
  text: string;
  /** Ground truth: is this an actionable commitment the agent should track? */
  isCommitment: boolean;
  note?: string;
}
