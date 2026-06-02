// The eyes: the Real-Time Search (RTS) API adapter.
//
// This is what makes Loose Ends passive and workspace-wide instead of a
// request/response bot. It does two jobs:
//   1. Surface new candidate messages from opted-in channels.
//   2. Detect fulfillment: given an open commitment, search for a later message
//      that satisfies it ("sent!", "done", the report link, etc.).
//
// The real implementation calls the RTS API exposed to the Slack agent. The shape
// below is the seam your platform glue plugs into. Replace MockWatcher with the
// RTS-backed implementation in week 1, keeping this interface stable.

import type { IncomingMessage, MessageRef } from "./types.ts";

export interface Watcher {
  /** New messages from opted-in channels since the last poll. */
  pollCandidates(sinceTs: string): Promise<IncomingMessage[]>;

  /**
   * Ask RTS whether `loop` looks fulfilled by recent activity in its thread or
   * channel. Returns the satisfying message, or null. Keeping this behind RTS
   * (rather than re-reading every message) is the scalable, technically interesting
   * part to highlight for the Best Tech prize. It is also how the loop is closed:
   * detecting that the work actually happened, not just nagging on a timer.
   */
  findFulfillment(loop: { source: MessageRef; summary: string; ownerId: string | null }): Promise<IncomingMessage | null>;
}

/** Offline stand-in so the pipeline and demo run without a live workspace. */
export class MockWatcher implements Watcher {
  private readonly script: IncomingMessage[];
  constructor(script: IncomingMessage[] = []) {
    this.script = script;
  }

  async pollCandidates(sinceTs: string): Promise<IncomingMessage[]> {
    return this.script.filter((m) => m.ts > sinceTs);
  }

  async findFulfillment(): Promise<IncomingMessage | null> {
    return null;
  }
}

/**
 * TODO(week1): implement against RTS.
 *   pollCandidates  -> RTS query scoped to opted-in channel ids, ts > cursor
 *   findFulfillment -> RTS query in commitment.source.thread/channel for
 *                      fulfillment-signal messages authored after the commitment,
 *                      then a cheap LLM yes/no to confirm it satisfies the summary.
 */
