// The offline message source for the no-workspace demo.
//
// In the REAL agent (src/slack/app.ts) there is no "watcher": ingestion is the
// Events API push stream (message.channels), and fulfillment is the evidence-
// based FulfillmentDetector reading that same stream. RTS is a pull/query API
// and cannot passively scan channels, so it is NOT used here (it's the on-demand
// "what's still open here?" lookup in src/slack/rts.ts instead).
//
// This interface exists only so the offline demo and tests can drive the same
// extract -> ledger pipeline from a scripted list of messages, with no workspace.

import type { IncomingMessage, MessageRef } from "./types.ts";

export interface Watcher {
  /** New messages from opted-in channels since the last poll. */
  pollCandidates(sinceTs: string): Promise<IncomingMessage[]>;

  /**
   * Offline stand-in for fulfillment: the mock returns null. The real agent does
   * evidence-based fulfillment via FulfillmentDetector over the Events stream.
   */
  findFulfillment(loop: { source: MessageRef; summary: string; ownerId: string | null }): Promise<IncomingMessage | null>;
}

/** A scripted piece of fulfillment evidence for the offline demo. */
export interface MockFulfillment {
  /** Case-insensitive substring of a loop's summary this evidence satisfies. */
  match: string;
  message: IncomingMessage;
}

/** Offline stand-in so the pipeline and demo run without a live workspace. */
export class MockWatcher implements Watcher {
  private readonly script: IncomingMessage[];
  private readonly fulfillments: MockFulfillment[];
  private revealed = false;
  constructor(script: IncomingMessage[] = [], fulfillments: MockFulfillment[] = []) {
    this.script = script;
    this.fulfillments = fulfillments;
  }

  async pollCandidates(sinceTs: string): Promise<IncomingMessage[]> {
    return this.script.filter((m) => m.ts > sinceTs);
  }

  /** Simulate the "done" message arriving later: reveal the scripted evidence. */
  revealFulfillments(): void {
    this.revealed = true;
  }

  async findFulfillment(loop: { summary: string }): Promise<IncomingMessage | null> {
    if (!this.revealed) return null;
    const hit = this.fulfillments.find((f) => loop.summary.toLowerCase().includes(f.match.toLowerCase()));
    return hit ? hit.message : null;
  }
}
