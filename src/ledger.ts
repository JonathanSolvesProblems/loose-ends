// The deterministic open-loop ledger: a pure state machine over loops.
//
// Nothing here calls the network, the clock, or the LLM. Every method that needs
// "now" takes it as an argument. That makes the whole lifecycle reproducible and
// trivially testable, which is exactly the property judges reward and clones lack.
//
// The escalation path (UNOWNED -> ESCALATED, DUE -> ESCALATED -> BROKEN) is what
// separates this from a personal-reminder bot: it routes a dropped loop to a
// backup human before a request is silently lost.

import type { ExtractedLoop, Loop, LoopStatus, MessageRef } from "./types.ts";

export interface LedgerConfig {
  /** How long an UNOWNED request may sit before it escalates to a coordinator (ms). */
  responseSlaMs: number;
  /** Grace after dueAt before a DUE loop escalates (ms). */
  graceMs: number;
  /** Grace after escalation before the loop is declared BROKEN (ms). */
  escalationGraceMs: number;
  /** Min extractor confidence to admit a loop at all. */
  minConfidence: number;
}

export const DEFAULT_CONFIG: LedgerConfig = {
  responseSlaMs: 4 * 60 * 60 * 1000, // 4h to claim an unowned request
  graceMs: 24 * 60 * 60 * 1000, // 24h past a deadline
  escalationGraceMs: 24 * 60 * 60 * 1000, // 24h after escalation
  minConfidence: 0.6,
};

/** Build a stable id from message coordinates so re-seeing a message can't double-track it. */
export function loopId(source: MessageRef): string {
  return `${source.channelId}:${source.ts}`;
}

export class Ledger {
  private items = new Map<string, Loop>();
  private readonly cfg: LedgerConfig;
  constructor(cfg: LedgerConfig = DEFAULT_CONFIG) {
    this.cfg = cfg;
  }

  all(): Loop[] {
    return [...this.items.values()];
  }

  get(id: string): Loop | undefined {
    return this.items.get(id);
  }

  /**
   * Admit a freshly extracted loop. Returns the stored Loop, or null if it was
   * rejected (low confidence) or duplicates one already tracked. Dedupe is
   * deterministic: same source message => same id => ignored.
   *
   * Initial status: a loop with an owner starts CLAIMED; an unclaimed request
   * starts UNOWNED.
   */
  admit(extracted: ExtractedLoop, source: MessageRef, now: number): Loop | null {
    if (extracted.confidence < this.cfg.minConfidence) return null;
    const id = loopId(source);
    if (this.items.has(id)) return null;

    const initial: LoopStatus = extracted.ownerId ? "CLAIMED" : "UNOWNED";
    const loop: Loop = {
      ...extracted,
      id,
      source,
      status: initial,
      createdAt: now,
      updatedAt: now,
      ...(initial === "UNOWNED" ? { unownedAt: now } : {}),
      history: [{ at: now, from: null, to: initial, reason: "admitted" }],
    };
    this.items.set(id, loop);
    return loop;
  }

  /**
   * Advance time-driven transitions for every loop. Call this on a timer. Returns
   * the loops that changed state, so the caller acts only on those. Pure w.r.t.
   * `now`. Settles fully: a large time jump can cross several transitions at once.
   */
  tick(now: number): Loop[] {
    const changed: Loop[] = [];
    for (const loop of this.items.values()) {
      let moved = false;
      for (let next = this.nextTimedStatus(loop, now); next && next !== loop.status; next = this.nextTimedStatus(loop, now)) {
        this.transition(loop, next, now, "timer");
        if (next === "ESCALATED") loop.escalatedAt = now;
        moved = true;
      }
      if (moved) changed.push(loop);
    }
    return changed;
  }

  private nextTimedStatus(loop: Loop, now: number): LoopStatus | null {
    switch (loop.status) {
      case "SNOOZED":
        if (loop.snoozeUntil == null || now < loop.snoozeUntil) return null;
        return loop.ownerId ? "CLAIMED" : "UNOWNED";
      case "UNOWNED":
        // Anchored to when it last became UNOWNED, not to createdAt. Otherwise a
        // loop snoozed for a week escalates the instant it wakes up.
        return now >= (loop.unownedAt ?? loop.createdAt) + this.cfg.responseSlaMs ? "ESCALATED" : null;
      case "CLAIMED":
        return loop.dueAt != null && now >= loop.dueAt ? "DUE" : null;
      case "DUE":
        return loop.dueAt != null && now >= loop.dueAt + this.cfg.graceMs ? "ESCALATED" : null;
      case "ESCALATED": {
        if (loop.escalatedAt == null) return null;
        const graceOver = now >= loop.escalatedAt + this.cfg.escalationGraceMs;
        // A loop is only "dropped" once its deadline has actually passed with no
        // evidence. An unclaimed request whose deadline is still in the future is
        // at risk, not broken: someone can still claim it and finish on time.
        const deadlinePassed = loop.dueAt == null || now >= loop.dueAt;
        return graceOver && deadlinePassed ? "BROKEN" : null;
      }
      default:
        return null; // BROKEN, FULFILLED, DISMISSED are terminal w.r.t. the timer
    }
  }

  // --- Event-driven transitions (claim, fulfillment, human review gate) ---

  /** A person claims an unowned request (or reassigns ownership). */
  claim(id: string, ownerId: string, now: number): Loop | undefined {
    const loop = this.items.get(id);
    if (!loop) return undefined;
    loop.ownerId = ownerId;
    return this.apply(id, "CLAIMED", now, `claimed-by:${ownerId}`);
  }

  markFulfilled(id: string, now: number, reason = "fulfillment-detected"): Loop | undefined {
    return this.apply(id, "FULFILLED", now, reason);
  }

  dismiss(id: string, now: number, reason = "reviewer:not-a-loop"): Loop | undefined {
    return this.apply(id, "DISMISSED", now, reason);
  }

  snooze(id: string, until: number, now: number): Loop | undefined {
    const loop = this.items.get(id);
    if (!loop) return undefined;
    loop.snoozeUntil = until;
    return this.apply(id, "SNOOZED", now, `snooze-until:${until}`);
  }

  /**
   * Once a loop is verified done or dismissed as noise, it is settled. A stale
   * Block Kit card is still clickable long after the fact, and a late tap must not
   * resurrect closed work. BROKEN is deliberately NOT final: a human may still
   * pick a dropped loop back up and mark it done.
   */
  private static readonly FINAL: LoopStatus[] = ["FULFILLED", "DISMISSED"];

  private apply(id: string, to: LoopStatus, now: number, reason: string): Loop | undefined {
    const loop = this.items.get(id);
    if (!loop) return undefined;
    if (loop.status === to) return loop;
    if (Ledger.FINAL.includes(loop.status)) return loop; // settled; ignore stale clicks
    this.transition(loop, to, now, reason);
    if (to === "ESCALATED") loop.escalatedAt = now;
    return loop;
  }

  private transition(loop: Loop, to: LoopStatus, now: number, reason: string) {
    loop.history.push({ at: now, from: loop.status, to, reason });
    // Restart the response-SLA clock whenever the loop (re)enters UNOWNED.
    if (to === "UNOWNED") loop.unownedAt = now;
    loop.status = to;
    loop.updatedAt = now;
  }
}
