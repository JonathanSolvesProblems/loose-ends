// Wiring: how the four pieces compose into the agent loop.
//
// Watcher (RTS, eyes) -> Extractor (Slack AI, judgment) -> Ledger (deterministic
// spine) -> ActionSink (MCP, hands, behind review gate). Run with the mocks via
// `npm run dev` to see the loop end to end with no workspace.

import { Ledger, DEFAULT_CONFIG } from "./ledger.ts";
import { HeuristicExtractor, type Extractor } from "./extractor.ts";
import { MockWatcher, type Watcher } from "./watcher.ts";
import { MockActionSink, buildNudgeCard, type ActionSink, type ReviewDecision } from "./actions.ts";
import type { IncomingMessage } from "./types.ts";

export class LooseEndsAgent {
  private cursorTs = "0";
  private readonly watcher: Watcher;
  private readonly extractor: Extractor;
  private readonly sink: ActionSink;
  private readonly ledger: Ledger;
  constructor(watcher: Watcher, extractor: Extractor, sink: ActionSink, ledger = new Ledger(DEFAULT_CONFIG)) {
    this.watcher = watcher;
    this.extractor = extractor;
    this.sink = sink;
    this.ledger = ledger;
  }

  /** One pass: ingest new messages, detect fulfillment, advance timers, nudge. */
  async step(now: number): Promise<void> {
    // 1. Ingest + extract + admit.
    const candidates = await this.watcher.pollCandidates(this.cursorTs);
    for (const msg of candidates) {
      this.cursorTs = max(this.cursorTs, msg.ts);
      const extracted = await this.extractor.extract(msg);
      if (extracted) this.ledger.admit(extracted, msg, now);
    }

    // 2. Detect fulfillment for still-open commitments (closes the loop).
    for (const c of this.ledger.all()) {
      if (c.status === "OPEN" || c.status === "DUE") {
        const hit = await this.watcher.findFulfillment(c);
        if (hit) this.ledger.markFulfilled(c.id, now);
      }
    }

    // 3. Advance deterministic timers and nudge only what just changed.
    for (const c of this.ledger.tick(now)) {
      if (c.status === "DUE" || c.status === "BROKEN") {
        await this.sink.sendNudge(c.ownerId, buildNudgeCard(c));
      }
    }
  }

  /** Apply a reviewer's button tap. This is the only path that writes back. */
  async review(commitmentId: string, decision: ReviewDecision, now: number): Promise<void> {
    if (decision.kind === "approve") {
      const c = this.ledger.get(commitmentId);
      if (c) await this.sink.createFollowUp(c);
    } else if (decision.kind === "snooze") {
      this.ledger.snooze(commitmentId, decision.until, now);
    } else {
      this.ledger.dismiss(commitmentId, now);
    }
  }

  snapshot() {
    return this.ledger.all();
  }
}

function max(a: string, b: string): string {
  return a >= b ? a : b;
}

// --- Demo runner: the loop with mocks, no workspace required. ---
async function demo() {
  const t0 = 1_700_000_000_000;
  const script: IncomingMessage[] = [
    { channelId: "C1", ts: "1", userId: "U_ALICE", text: "I'll get the grant report to you by Friday.", observedAt: t0 },
    { channelId: "C1", ts: "2", userId: "U_BOB", text: "we should grab lunch sometime", observedAt: t0 },
    { channelId: "C1", ts: "3", userId: "U_CARA", text: "I'll think about it", observedAt: t0 },
  ];
  const agent = new LooseEndsAgent(new MockWatcher(script), new HeuristicExtractor(), new MockActionSink());

  await agent.step(t0); // ingest
  await agent.step(t0 + 5 * 24 * 60 * 60 * 1000); // jump past the deadline + grace

  for (const c of agent.snapshot()) {
    console.log(`${c.status.padEnd(9)} ${c.summary}`);
  }
  // Expect: only Alice's promise is tracked and goes BROKEN. The lunch and the
  // "I'll think about it" never enter the ledger. That silence is the demo.
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demo();
}
