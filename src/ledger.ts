// The deterministic commitment ledger: a pure state machine over commitments.
//
// Nothing here calls the network, the clock, or the LLM. Every method that needs
// "now" takes it as an argument. That makes the whole lifecycle reproducible and
// trivially testable, which is exactly the property judges reward and clones lack.

import type { Commitment, CommitmentStatus, ExtractedCommitment, MessageRef } from "./types.ts";

export interface LedgerConfig {
  /** Grace window after dueAt before a DUE commitment becomes BROKEN (ms). */
  graceMs: number;
  /** Min extractor confidence to admit a commitment at all. */
  minConfidence: number;
}

export const DEFAULT_CONFIG: LedgerConfig = {
  graceMs: 24 * 60 * 60 * 1000, // 24h
  minConfidence: 0.6,
};

/** Build a stable id from message coordinates so re-seeing a message can't double-track it. */
export function commitmentId(source: MessageRef): string {
  return `${source.channelId}:${source.ts}`;
}

export class Ledger {
  private items = new Map<string, Commitment>();
  private readonly cfg: LedgerConfig;
  constructor(cfg: LedgerConfig = DEFAULT_CONFIG) {
    this.cfg = cfg;
  }

  all(): Commitment[] {
    return [...this.items.values()];
  }

  get(id: string): Commitment | undefined {
    return this.items.get(id);
  }

  /**
   * Admit a freshly extracted commitment. Returns the stored Commitment, or null
   * if it was rejected (low confidence) or is a duplicate of one already tracked.
   * Dedupe is deterministic: same source message => same id => ignored.
   */
  admit(extracted: ExtractedCommitment, source: MessageRef, now: number): Commitment | null {
    if (extracted.confidence < this.cfg.minConfidence) return null;
    const id = commitmentId(source);
    if (this.items.has(id)) return null;

    const c: Commitment = {
      ...extracted,
      id,
      source,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, from: null, to: "OPEN", reason: "admitted" }],
    };
    this.items.set(id, c);
    return c;
  }

  /**
   * Advance time-driven transitions for every commitment. Call this on a timer.
   * Returns the commitments that changed state, so the caller can act on them
   * (and only them). Pure with respect to `now`.
   */
  tick(now: number): Commitment[] {
    const changed: Commitment[] = [];
    for (const c of this.items.values()) {
      let moved = false;
      // Settle fully: a large time jump can cross OPEN -> DUE -> BROKEN at once.
      for (let next = this.nextTimedStatus(c, now); next && next !== c.status; next = this.nextTimedStatus(c, now)) {
        this.transition(c, next, now, "timer");
        moved = true;
      }
      if (moved) changed.push(c);
    }
    return changed;
  }

  private nextTimedStatus(c: Commitment, now: number): CommitmentStatus | null {
    switch (c.status) {
      case "SNOOZED":
        return c.snoozeUntil != null && now >= c.snoozeUntil ? "OPEN" : null;
      case "OPEN":
        return c.dueAt != null && now >= c.dueAt ? "DUE" : null;
      case "DUE":
        return c.dueAt != null && now >= c.dueAt + this.cfg.graceMs ? "BROKEN" : null;
      default:
        return null; // FULFILLED, BROKEN, DISMISSED are terminal w.r.t. the timer
    }
  }

  // --- Event-driven transitions (fulfillment detection + human review gate) ---

  markFulfilled(id: string, now: number, reason = "fulfillment-detected"): Commitment | undefined {
    return this.apply(id, "FULFILLED", now, reason);
  }

  dismiss(id: string, now: number, reason = "user:not-a-commitment"): Commitment | undefined {
    return this.apply(id, "DISMISSED", now, reason);
  }

  snooze(id: string, until: number, now: number): Commitment | undefined {
    const c = this.items.get(id);
    if (!c) return undefined;
    c.snoozeUntil = until;
    return this.apply(id, "SNOOZED", now, `user:snooze-until:${until}`);
  }

  private apply(id: string, to: CommitmentStatus, now: number, reason: string): Commitment | undefined {
    const c = this.items.get(id);
    if (!c) return undefined;
    if (c.status === to) return c;
    this.transition(c, to, now, reason);
    return c;
  }

  private transition(c: Commitment, to: CommitmentStatus, now: number, reason: string) {
    c.history.push({ at: now, from: c.status, to, reason });
    c.status = to;
    c.updatedAt = now;
  }
}
