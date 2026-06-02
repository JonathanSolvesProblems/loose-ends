// Wiring: how the four pieces compose into the agent loop.
//
// Watcher (RTS, eyes) -> Extractor (Slack AI, judgment) -> Ledger (deterministic
// spine) -> ActionSink (MCP, hands, behind a review gate). Run with the mocks via
// `npm run dev` to see the loop end to end with no workspace.

import { Ledger, DEFAULT_CONFIG } from "./ledger.ts";
import { HeuristicExtractor, type Extractor } from "./extractor.ts";
import { MockWatcher, type Watcher } from "./watcher.ts";
import { MockActionSink, buildCard, type ActionSink, type ReviewDecision } from "./actions.ts";
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

  /** One pass: ingest new messages, detect fulfillment, advance timers, send cards. */
  async step(now: number): Promise<void> {
    // 1. Ingest + extract + admit.
    const candidates = await this.watcher.pollCandidates(this.cursorTs);
    for (const msg of candidates) {
      this.cursorTs = max(this.cursorTs, msg.ts);
      const extracted = await this.extractor.extract(msg);
      if (extracted) this.ledger.admit(extracted, msg, now);
    }

    // 2. Detect fulfillment for still-open loops (closes the loop via RTS).
    for (const loop of this.ledger.all()) {
      if (loop.status === "CLAIMED" || loop.status === "DUE" || loop.status === "ESCALATED") {
        const hit = await this.watcher.findFulfillment(loop);
        if (hit) this.ledger.markFulfilled(loop.id, now);
      }
    }

    // 3. Advance deterministic timers and act only on what just changed.
    for (const loop of this.ledger.tick(now)) {
      if (loop.status === "DUE" || loop.status === "ESCALATED") {
        const card = buildCard(loop);
        // Owner cards go to the owner; coordinator cards go to a routing target.
        const target = card.audience === "owner" && loop.ownerId ? loop.ownerId : COORDINATOR_ID;
        await this.sink.sendCard(target, card);
      }
    }
  }

  /** Apply a reviewer's button tap. This is the only path that writes back. */
  async review(loopId: string, decision: ReviewDecision, now: number): Promise<void> {
    if (decision.kind === "claim") {
      this.ledger.claim(loopId, decision.ownerId, now);
    } else if (decision.kind === "approve") {
      const loop = this.ledger.get(loopId);
      if (loop) await this.sink.createFollowUp(loop);
    } else if (decision.kind === "snooze") {
      this.ledger.snooze(loopId, decision.until, now);
    } else {
      this.ledger.dismiss(loopId, now);
    }
  }

  snapshot() {
    return this.ledger.all();
  }
}

const COORDINATOR_ID = "U_COORDINATOR";

function max(a: string, b: string): string {
  return a >= b ? a : b;
}

// --- Demo runner: the loop with mocks, no workspace required. ---
async function demo() {
  const t0 = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const script: IncomingMessage[] = [
    // Unowned request: nobody is named. This is the un-cloned case existing bots miss.
    { channelId: "C1", ts: "1", userId: "U_LEAD", text: "Can someone follow up with the Diaz family about their housing application?", observedAt: t0 },
    // First-person commitment with a deadline.
    { channelId: "C1", ts: "2", userId: "U_ALICE", text: "I'll get the grant report to the funder by Friday.", observedAt: t0 },
    // Social filler. Must never be tracked.
    { channelId: "C1", ts: "3", userId: "U_BOB", text: "we should grab lunch sometime", observedAt: t0 },
    // Non-actionable. Must never be tracked.
    { channelId: "C1", ts: "4", userId: "U_CARA", text: "I'll think about it, no rush", observedAt: t0 },
  ];
  const agent = new LooseEndsAgent(new MockWatcher(script), new HeuristicExtractor(), new MockActionSink());

  await agent.step(t0); // ingest
  await agent.step(t0 + 5 * DAY); // both open loops escalate: nobody acted in time

  // The rescue: a coordinator sees the escalated card and claims the Diaz request.
  // "C1:1" is the loop id (channelId:ts) of the unowned request.
  await agent.review("C1:1", { kind: "claim", ownerId: "U_COORDINATOR" }, t0 + 5 * DAY);

  await agent.step(t0 + 9 * DAY); // time moves on; the unacted commitment breaks

  for (const loop of agent.snapshot()) {
    console.log(`${loop.status.padEnd(10)} ${loop.kind.padEnd(11)} ${loop.summary}`);
  }
  // Expect: the Diaz family request was CLAIMED in time (the safety net worked);
  // Alice's grant report is BROKEN (escalated, still nobody closed it). The lunch
  // invite and "I'll think about it" never enter the ledger. That silence is the
  // negative control.
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demo();
}
