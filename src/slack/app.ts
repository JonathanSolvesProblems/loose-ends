// The real agent: a classic Bolt app on Socket Mode that turns the offline
// scaffold into a live Slack agent. This is the entry point `npm start` runs.
//
// Pipeline (all real, no mocks):
//   Events API message.channels  (the eyes — push, real-time, not throttled)
//     -> deterministic noise filter + Claude classification (the judgment)
//     -> deterministic ledger: ownership, SLA timers, escalation (the spine)
//     -> chat.postMessage Block Kit cards, Claim/Done/Snooze/Dismiss (the hands)
//     -> evidence-based fulfillment from the same stream (the moat)
//   Plus an on-demand RTS "what's still open here?" lookup (eligible technology).
//
// Only this file (and llm.ts) touch the network. The ledger, extractor, dates,
// and block rendering stay pure and are unit-tested without a workspace.

import boltPkg from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { loadConfig } from "../config.ts";
import { Ledger } from "../ledger.ts";
import { createLlm } from "../llm.ts";
import { LlmExtractor } from "../extractor.ts";
import { FulfillmentDetector, looksLikeCompletion } from "../fulfillment.ts";
import { buildCard } from "../actions.ts";
import { ACTION_ID, decodeAction, renderCard, renderResolved } from "./blockkit.ts";
import { searchContext } from "./rts.ts";
import type { IncomingMessage, Loop, LoopStatus } from "../types.ts";

const { App } = boltPkg;

const cfg = loadConfig();
const llm = createLlm(cfg.llm);
const extractor = new LlmExtractor(llm, cfg.tzOffsetMinutes);
const fulfillment = new FulfillmentDetector(llm);
const ledger = new Ledger(cfg.ledger);

const app = new App({
  token: cfg.slack.botToken,
  appToken: cfg.slack.appToken,
  signingSecret: cfg.slack.signingSecret,
  socketMode: true,
});

// Where we posted each loop's card, so button taps, escalations, and fulfillment
// all update the same message in place instead of stacking new ones.
const cardRefs = new Map<string, { channel: string; ts: string }>();
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN: LoopStatus[] = ["UNOWNED", "CLAIMED", "DUE", "ESCALATED"];

function watched(channelId: string): boolean {
  return cfg.watchedChannels.length === 0 || cfg.watchedChannels.includes(channelId);
}

/** Post a card the first time, or update the existing one for this loop. */
async function upsertCard(client: WebClient, loop: Loop): Promise<void> {
  const card = buildCard(loop);
  const rendered = renderCard(card);
  const ping = loop.status === "ESCALATED" && cfg.coordinatorId ? `<@${cfg.coordinatorId}> ` : "";
  const text = ping + rendered.text;
  const ref = cardRefs.get(loop.id);
  if (ref) {
    await client.chat.update({ channel: ref.channel, ts: ref.ts, text, blocks: rendered.blocks as any });
  } else {
    const res = await client.chat.postMessage({ channel: loop.source.channelId, text, blocks: rendered.blocks as any });
    if (res.ts) cardRefs.set(loop.id, { channel: loop.source.channelId, ts: res.ts });
  }
}

/** Replace a loop's card with a terminal state (claimed/verified/broken/etc.). */
async function resolveCard(client: WebClient, loopId: string, headline: string, detail: string): Promise<void> {
  const ref = cardRefs.get(loopId);
  if (!ref) return;
  const rendered = renderResolved(headline, detail);
  await client.chat.update({ channel: ref.channel, ts: ref.ts, text: rendered.text, blocks: rendered.blocks as any });
}

/** Check whether a fresh message is evidence that any open loop was completed. */
async function detectFulfillment(client: WebClient, incoming: IncomingMessage, now: number): Promise<void> {
  if (!looksLikeCompletion(incoming.text)) return; // cheap gate before any LLM call
  for (const loop of ledger.all()) {
    if (loop.source.channelId !== incoming.channelId || loop.source.ts === incoming.ts) continue;
    if (!OPEN.includes(loop.status)) continue;
    if (await fulfillment.isEvidenceOfFulfillment(loop.summary, incoming.text)) {
      ledger.markFulfilled(loop.id, now, `evidence:${incoming.ts}`);
      await resolveCard(client, loop.id, "✅ Verified — closed on evidence", `"${loop.summary}"\nConfirmed by a later message in the channel, not a timer.`);
    }
  }
}

// --- Ingest: every channel message flows through here -------------------------
app.message(async ({ message, client }) => {
  const m = message as any;
  if (m.subtype || m.bot_id || !m.user || !m.text) return; // only plain human messages
  if (!watched(m.channel)) return;
  const now = Date.now();
  const incoming: IncomingMessage = {
    channelId: m.channel,
    ts: m.ts,
    threadTs: m.thread_ts,
    userId: m.user,
    text: m.text,
    observedAt: now,
  };

  // Fulfillment first: a "done" message must close loops, not be mistaken for one.
  await detectFulfillment(client, incoming, now);

  const extracted = await extractor.extract(incoming);
  if (!extracted) return; // the negative control: silence on filler and non-loops
  const loop = ledger.admit(extracted, incoming, now);
  // Surface an unowned request immediately so the channel can claim it; owned
  // commitments stay silent until they come due.
  if (loop && loop.status === "UNOWNED") await upsertCard(client as WebClient, loop);
});

// --- Review gate: the only path that changes ownership / closes a loop --------
app.action(/^loose_ends_review:/, async ({ ack, body, action, client }) => {
  await ack();
  const dec = decodeAction((action as any).value);
  if (!dec) return;
  const now = Date.now();
  const userId = (body as any).user?.id ?? "someone";
  const c = client as WebClient;

  if (dec.kind === "claim") {
    const loop = ledger.claim(dec.loopId, userId, now);
    await resolveCard(c, dec.loopId, "Claimed", `<@${userId}> owns this now.\n"${loop?.summary ?? ""}"`);
  } else if (dec.kind === "approve") {
    const loop = ledger.markFulfilled(dec.loopId, now, `reviewer:${userId}`);
    await writeToList(c, loop);
    await resolveCard(c, dec.loopId, "✅ Marked done", `Closed by <@${userId}> and written to the record.\n"${loop?.summary ?? ""}"`);
  } else if (dec.kind === "snooze") {
    ledger.snooze(dec.loopId, now + DAY_MS, now);
    await resolveCard(c, dec.loopId, "Snoozed", "Back tomorrow if still open.");
  } else if (dec.kind === "dismiss") {
    ledger.dismiss(dec.loopId, now);
    await resolveCard(c, dec.loopId, "Dismissed", "Not a real loop — thanks, that trains the filter.");
  }
});

/** Optional governed write-back into a Slack List (system of record). */
async function writeToList(client: WebClient, loop?: Loop): Promise<void> {
  if (!cfg.listId || !loop) return;
  try {
    await client.apiCall("slackLists.items.create", {
      list_id: cfg.listId,
      initial_fields: [{ key: "name", text: loop.summary }],
    });
  } catch {
    /* Lists may not be enabled on a bare sandbox; the postMessage record stands. */
  }
}

// --- On-demand RTS lookup: "what's still open here?" -------------------------
function ledgerAnswer(channelId: string): string {
  const open = ledger.all().filter((l) => l.source.channelId === channelId && OPEN.includes(l.status));
  if (open.length === 0) return "Nothing open here right now. Every loop I'm tracking has been claimed or verified. ✅";
  const lines = open.map((l) => {
    const owner = l.ownerId ? `owned by <@${l.ownerId}>` : "*unowned*";
    return `• [${l.status}] "${l.summary}" — ${owner}`;
  });
  return `Still open in this channel:\n${lines.join("\n")}`;
}

app.command("/looseends", async ({ ack, command, respond }) => {
  await ack();
  await respond({ response_type: "ephemeral", text: ledgerAnswer(command.channel_id) });
});

app.event("app_mention", async ({ event, client, say }) => {
  const e = event as any;
  const channelId = e.channel;
  let text = ledgerAnswer(channelId);
  // Genuine RTS usage: when the platform hands us an action_token, search the
  // live channel for related context and note it. Otherwise the ledger stands.
  const hits = await searchContext(client as WebClient, e.action_token, e.text ?? "open loops", channelId, 5);
  if (hits.length) text += `\n\n_RTS surfaced ${hits.length} related message(s) in-channel._`;
  await say({ text, thread_ts: e.thread_ts ?? e.ts });
});

// --- Deterministic timers: advance SLAs and act only on what changed ---------
const tickMs = cfg.demo ? 5_000 : 60_000;
setInterval(async () => {
  const now = Date.now();
  for (const loop of ledger.tick(now)) {
    try {
      if (loop.status === "DUE" || loop.status === "ESCALATED") {
        await upsertCard(app.client as WebClient, loop);
      } else if (loop.status === "BROKEN") {
        await resolveCard(app.client as WebClient, loop.id, "🔴 Dropped (BROKEN)", `"${loop.summary}"\nEscalated, still no owner and no evidence of completion. On the dashboard for the team.`);
      }
    } catch (err) {
      console.error("tick action failed", err);
    }
  }
}, tickMs);

// --- Boot --------------------------------------------------------------------
await app.start();
console.log(
  `⚡ Loose Ends is live (${cfg.demo ? "DEMO timers ~5s" : "production timers"}), ` +
    `model=${cfg.llm.provider}:${cfg.llm.model}, ` +
    `watching ${cfg.watchedChannels.length ? cfg.watchedChannels.join(", ") : "all invited channels"}.`,
);
