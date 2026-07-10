// The real agent: a classic Bolt app on Socket Mode that turns the offline
// scaffold into a live Slack agent. This is the entry point `npm start` runs.
//
// Pipeline (all real, no mocks):
//   Events API message.channels  (the eyes — push, real-time, not throttled)
//     -> deterministic noise filter + LLM classification (the judgment)
//     -> deterministic ledger: ownership, SLA timers, escalation (the spine)
//     -> chat.postMessage Block Kit cards, Claim/Done/Snooze/Dismiss (the hands)
//     -> evidence-based fulfillment from the same stream (the moat)
//   Plus the qualifying technology: an on-demand RTS scan that surfaces work
//   dropped BEFORE the agent was ever installed. Read-only; nothing is stored.
//
// Only this file (and llm.ts) touch the network. The ledger, extractor, dates,
// and block rendering stay pure and are unit-tested without a workspace.

import boltPkg from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { loadConfig } from "../config.ts";
import { Ledger } from "../ledger.ts";
import { createLlm } from "../llm.ts";
import { LlmExtractor, isSoftNoise } from "../extractor.ts";
import { FulfillmentDetector } from "../fulfillment.ts";
import { buildCard } from "../actions.ts";
import { mapLimit } from "../limit.ts";
import { ACTION_ID, decodeAction, renderCard, renderResolved } from "./blockkit.ts";
import { searchContext, type RtsHit } from "./rts.ts";
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
/** Statuses a loop never comes back from, so its card can be forgotten. */
const DONE_WITH: LoopStatus[] = ["FULFILLED", "BROKEN", "DISMISSED"];
/** Max simultaneous model requests triggered by one Slack message or one scan. */
const MODEL_CONCURRENCY = 4;

/** Unbuffered logger: stderr flushes synchronously, so activity shows live in logs. */
function log(...args: unknown[]): void {
  console.error("[loose-ends]", ...args);
}

/**
 * Message text in a frontline channel contains client names ("follow up with the
 * Diaz family"). Writing that to container logs on a shared host would quietly
 * contradict the privacy posture this project claims. So content is redacted
 * unless explicitly opted in, which demo mode does so the video has readable logs.
 */
const LOG_CONTENT = cfg.demo || process.env.LOOSE_ENDS_LOG_CONTENT === "1";
function preview(text: string): string {
  return LOG_CONTENT ? JSON.stringify(text) : `<redacted, ${text.length} chars>`;
}

function watched(channelId: string): boolean {
  return cfg.watchedChannels.length === 0 || cfg.watchedChannels.includes(channelId);
}

/**
 * Immediate "I'm looking at this" feedback, the same 👀-while-working convention
 * Slack's own agent template uses. The LLM call takes a beat; a human shouldn't
 * wonder whether the bot saw their message. Degrades silently if the
 * reactions:write scope isn't granted.
 */
async function react(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.add({ channel, timestamp: ts, name });
  } catch {
    /* scope missing, or already reacted */
  }
}

async function unreact(client: WebClient, channel: string, ts: string, name: string): Promise<void> {
  try {
    await client.reactions.remove({ channel, timestamp: ts, name });
  } catch {
    /* nothing to remove */
  }
}

/**
 * The author's UTC offset, so "by 2am" is grounded in THEIR day, not UTC. Slack
 * gives us tz_offset in seconds; cache it so we call users.info once per person.
 * Falls back to the configured workspace offset on any failure.
 */
const tzCache = new Map<string, number>();
const TZ_CACHE_MAX = 500;
async function tzFor(client: WebClient, userId: string): Promise<number> {
  const cached = tzCache.get(userId);
  if (cached !== undefined) return cached;
  if (tzCache.size >= TZ_CACHE_MAX) tzCache.clear(); // bounded; a re-fetch is cheap
  let minutes = cfg.tzOffsetMinutes;
  try {
    const res: any = await client.users.info({ user: userId });
    const seconds = res?.user?.tz_offset;
    if (typeof seconds === "number") minutes = Math.round(seconds / 60);
  } catch {
    /* users:read missing or user unreachable — fall back to the config default */
  }
  tzCache.set(userId, minutes);
  return minutes;
}

/** Who should actually act, so Slack notifies the right human (and only them). */
function mentionFor(loop: Loop, audience: "owner" | "coordinator"): string | undefined {
  if (loop.status === "ESCALATED") return (audience === "coordinator" ? cfg.coordinatorId : loop.ownerId) || undefined;
  if (loop.status === "DUE") return loop.ownerId || undefined;
  return undefined; // a fresh "needs an owner" card shouldn't ping anyone yet
}

/** Post a card the first time, or update the existing one for this loop. */
async function upsertCard(client: WebClient, loop: Loop): Promise<void> {
  const card = buildCard(loop);
  const rendered = renderCard(card, mentionFor(loop, card.audience));
  const ref = cardRefs.get(loop.id);
  if (ref) {
    await client.chat.update({ channel: ref.channel, ts: ref.ts, text: rendered.text, blocks: rendered.blocks as any });
  } else {
    const res = await client.chat.postMessage({ channel: loop.source.channelId, text: rendered.text, blocks: rendered.blocks as any });
    if (res.ts) cardRefs.set(loop.id, { channel: loop.source.channelId, ts: res.ts });
  }
}

/** Replace a loop's card with a terminal state (claimed/verified/broken/etc.). */
async function resolveCard(client: WebClient, loopId: string, headline: string, detail: string, note?: string): Promise<void> {
  const ref = cardRefs.get(loopId);
  if (!ref) return;
  const rendered = renderResolved(headline, detail, note);
  await client.chat.update({ channel: ref.channel, ts: ref.ts, text: rendered.text, blocks: rendered.blocks as any });

  // A verified, broken, or dismissed loop will never be re-rendered, so stop
  // holding its message coordinates. Long-running agents should not grow forever.
  // SNOOZED is NOT terminal: it wakes back up and needs its card again, so it must
  // keep its coordinates.
  const loop = ledger.get(loopId);
  if (loop && DONE_WITH.includes(loop.status)) cardRefs.delete(loopId);
}

/**
 * Check whether a fresh message is evidence that any open loop was completed.
 * Returns true if it closed at least one loop, so the caller can mark the
 * evidence message itself with a ✅.
 */
async function detectFulfillment(client: WebClient, incoming: IncomingMessage, now: number): Promise<boolean> {
  // No blanket keyword gate here: real evidence is often oblique ("the Diaz family
  // has their voucher now"). isEvidenceOfFulfillment applies a per-loop gate, so a
  // message only reaches the model if it plausibly bears on THAT loop.
  const open = ledger
    .all()
    .filter((l) => l.source.channelId === incoming.channelId && l.source.ts !== incoming.ts)
    .filter((l) => OPEN.includes(l.status));
  if (open.length === 0) return false;

  // Check the loops concurrently but BOUNDED. Serial left the eyes reaction sitting
  // on the message for seconds in a busy channel; unbounded would fire one model
  // request per open loop at once and earn a 429. The gate inside means most of
  // these resolve without a model call at all.
  const results = await mapLimit(open, MODEL_CONCURRENCY, async (loop) => ({
    loop,
    isEvidence: await fulfillment.isEvidenceOfFulfillment(loop.summary, incoming.text),
  }));

  let verified = false;
  for (const { loop, isEvidence } of results) {
    if (!isEvidence) continue;
    ledger.markFulfilled(loop.id, now, `evidence:${incoming.ts}`);
    log(`  ✓ VERIFIED on evidence: ${preview(loop.summary)}`);
    await resolveCard(
      client,
      loop.id,
      "✅ Verified — closed on evidence",
      `"${loop.summary}"`,
      "A later message in this channel showed the work actually landed. Closed on evidence, not because a timer ran out.",
    );
    verified = true;
  }
  return verified;
}

// --- Ingest: every channel message flows through here -------------------------
app.message(async ({ message, client, context }) => {
  const m = message as any;
  if (m.subtype || m.bot_id || !m.user || !m.text) return; // only plain human messages
  if (!watched(m.channel)) return;

  // A message that @-mentions us is a COMMAND to the agent ("@loose-ends scan this
  // channel"), not a request for a human to do work. Without this, the agent
  // tracks its own instructions as open loops.
  const botUserId = (context as any)?.botUserId;
  if (botUserId && m.text.includes(`<@${botUserId}>`)) {
    log(`msg #${m.channel} <${m.user}>: addressed to me — handled as a command, not a loop`);
    return;
  }

  const now = Date.now();
  const c = client as WebClient;
  const incoming: IncomingMessage = {
    channelId: m.channel,
    ts: m.ts,
    threadTs: m.thread_ts,
    userId: m.user,
    text: m.text,
    observedAt: now,
    tzOffsetMinutes: await tzFor(c, m.user),
  };

  log(`msg #${m.channel} <${m.user}>: ${preview(m.text)}`);

  // Obvious filler never costs a token and never gets a reaction: the agent is
  // simply silent. Anything else gets an immediate 👀 so the human knows it was
  // seen while the model thinks.
  const thinking = !isSoftNoise(incoming.text);
  if (thinking) await react(c, m.channel, m.ts, "eyes");

  try {
    // Fulfillment first: a "done" message must close loops, not be mistaken for one.
    if (await detectFulfillment(c, incoming, now)) {
      await react(c, m.channel, m.ts, "white_check_mark"); // this message was the proof
    }

    const extracted = await extractor.extract(incoming);
    if (!extracted) {
      log("  → ignored (noise / not a loop)"); // the negative control
      return;
    }
    const loop = ledger.admit(extracted, incoming, now);
    if (loop) log(`  → ${loop.kind} ${loop.status}: ${preview(loop.summary)}`);
    // Surface an unowned request immediately so the channel can claim it; owned
    // commitments stay silent until they come due.
    if (loop && loop.status === "UNOWNED") await upsertCard(c, loop);
  } finally {
    if (thinking) await unreact(c, m.channel, m.ts, "eyes");
  }
});

// --- Review gate: the only path that changes ownership / closes a loop --------
app.action(/^loose_ends_review:/, async ({ ack, body, action, client, respond }) => {
  await ack();
  const dec = decodeAction((action as any).value);
  if (!dec) return;
  const now = Date.now();
  const userId = (body as any).user?.id ?? "someone";
  const c = client as WebClient;
  log(`action: ${dec.kind} on ${dec.loopId} by ${userId}`);

  // A Block Kit card outlives the process that posted it. The ledger is in memory
  // today, so after a restart or redeploy every older card is a button that would
  // otherwise do absolutely nothing when tapped. Say so, rather than going silent.
  if (!ledger.get(dec.loopId)) {
    log(`  → unknown loop (restarted since this card was posted)`);
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text:
        "I've restarted since I posted that card, so I'm not tracking this loop any more. " +
        "My ledger lives in memory today, which is the first thing a production deployment would fix. " +
        "Post the ask again and I'll pick it straight back up.",
    });
    return;
  }

  if (dec.kind === "claim") {
    const loop = ledger.claim(dec.loopId, userId, now);
    await resolveCard(
      c,
      dec.loopId,
      "Claimed",
      `<@${userId}> owns this now.\n"${loop?.summary ?? ""}"`,
      "I'll speak up again only if its deadline passes with no sign the work landed.",
    );
  } else if (dec.kind === "approve") {
    const loop = ledger.markFulfilled(dec.loopId, now, `reviewer:${userId}`);
    await writeToList(c, loop);
    await resolveCard(
      c,
      dec.loopId,
      "✅ Marked done",
      `Closed by <@${userId}>.\n"${loop?.summary ?? ""}"`,
      "Confirmed by a human and written to the record.",
    );
  } else if (dec.kind === "snooze") {
    ledger.snooze(dec.loopId, now + DAY_MS, now);
    await resolveCard(c, dec.loopId, "Snoozed", "I'll bring this back tomorrow if it's still open.");
  } else if (dec.kind === "dismiss") {
    ledger.dismiss(dec.loopId, now);
    await resolveCard(c, dec.loopId, "Dismissed", "Not a real loop.", "Thanks — that feedback is what tunes the filter.");
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

/** How far back a retroactive scan looks. */
const SCAN_LOOKBACK_DAYS = 30;
/** Cap the LLM fan-out and how much a single briefing reports. */
const SCAN_MAX_CLASSIFY = 20;
const SCAN_MAX_REPORTED = 8;

/** One piece of work the RTS briefing surfaced. Held in memory for this reply only. */
interface ScanFinding {
  kind: string;
  summary: string;
  ownerId: string | null;
  permalink?: string;
  /** How many separate messages asked for this same thing. >1 is a damning signal. */
  occurrences: number;
}

/** The same message can be returned by both searches. Keep one copy of each. */
function dedupeByTs(hits: RtsHit[]): RtsHit[] {
  const seen = new Map<string, RtsHit>();
  for (const h of hits) if (!seen.has(h.ts)) seen.set(h.ts, h);
  return [...seen.values()];
}

/** What a briefing found. Only `open` is dropped work; the rest is context. */
interface ScanResult {
  open: ScanFinding[];
  /** Asked, and a later message proved it was finished. */
  completed: number;
  /** Already being tracked by the live pipeline, so not re-reported. */
  alreadyTracking: number;
}

/**
 * THE RTS FEATURE, and the reason RTS is load-bearing rather than decorative.
 *
 * Loose Ends only sees messages sent while it was running. A channel that existed
 * before the agent was installed can already be full of asks nobody picked up.
 * RTS is the ONLY way to surface them: conversations.history is throttled to 1
 * request/minute (max 15 objects) for non-Marketplace apps, so a real backfill is
 * impossible. Remove RTS and this capability disappears entirely.
 *
 * COMPLIANCE (this shape is deliberate, not incidental). Slack's RTS terms say
 * verbatim: "You must not store or copy any of the data retrieved from this API",
 * and the API is "intended to be used in response to user interactions". So this
 * is a READ-ONLY, USER-INVOKED BRIEFING:
 *   - it only ever runs when a human @-mentions the agent and asks,
 *   - retrieved text is held in memory just long enough to classify it,
 *   - NOTHING derived from an RTS hit is ever written to the ledger.
 * We hand the human a list plus permalinks and let them decide. The ledger is fed
 * exclusively by the Events API, which carries no such restriction.
 */
async function scanChannel(
  client: WebClient,
  channelId: string,
  actionToken: string | undefined,
  botUserId: string | undefined,
): Promise<ScanResult> {
  const afterEpochSec = Math.floor((Date.now() - SCAN_LOOKBACK_DAYS * DAY_MS) / 1000);
  const usable = (h: RtsHit) =>
    h.channelId === channelId && // context_channel_id is a SOFT scope
    !!h.ts &&
    !h.isBot && // never treat our own cards as evidence or as asks
    !!h.authorId &&
    h.authorId !== botUserId &&
    !(botUserId && h.text.includes(`<@${botUserId}>`)); // commands, not work

  // Two searches, run in sequence because the action_token is ephemeral and
  // per-interaction: one for what was asked, one for what was reported finished.
  // Without evidence, the scan reports already-completed work as dropped every time
  // the in-memory ledger is empty, which is after every restart.
  const asks = await searchContext(client, {
    actionToken,
    query: "requests, asks, action items, or promises that were never completed",
    channelId,
    afterEpochSec,
    limit: SCAN_MAX_CLASSIFY,
  });
  const reports = await searchContext(client, {
    actionToken,
    query: "messages reporting that work was completed, finished, sent, filed, closed, delivered, or handled",
    channelId,
    afterEpochSec,
    limit: SCAN_MAX_CLASSIFY,
  });

  // EVERY message either search returned is a candidate piece of evidence, not just
  // the ones the evidence query happened to rank. A semantic query for "work was
  // completed" can easily miss "the Diaz family has their voucher now", and it can
  // just as easily match only the agent's own cards, which is exactly what happened
  // the first time. Pooling both result sets removes that dependency on phrasing.
  const evidencePool = dedupeByTs([...asks, ...reports]).filter(usable);
  log(`RTS scan: asks=${asks.length}, reports=${reports.length}, evidence pool=${evidencePool.length}`);

  let alreadyTracking = 0;
  const candidates = asks.filter(usable).filter((h) => {
    if (ledger.get(`${channelId}:${h.ts}`)) {
      alreadyTracking++; // the live pipeline already owns this one
      return false;
    }
    return true;
  }).slice(0, SCAN_MAX_CLASSIFY);

  // The same ask often appears as several separate messages ("can someone follow
  // up with the Diaz family?" asked three times over a week). Report the WORK
  // once, and count how many times it was asked. "Asked 3 times, still nobody
  // claimed it" is a far stronger signal than three identical bullets.
  // Classify with bounded concurrency. Twenty sequential model round-trips left the
  // coordinator staring at "Searching..."; twenty at once would rate-limit.
  const classified = await mapLimit(candidates, MODEL_CONCURRENCY, async (h) => {
    const incoming: IncomingMessage = {
      channelId,
      ts: h.ts,
      userId: h.authorId!,
      text: h.text, // transient: classified, then dropped. Never persisted.
      observedAt: Number(h.ts) * 1000 || Date.now(),
      permalink: h.permalink,
      tzOffsetMinutes: await tzFor(client, h.authorId!),
    };
    return { hit: h, extracted: await extractor.extract(incoming) };
  });

  // For each ask, look for a LATER message proving it was done. This is the same
  // evidence test the live pipeline uses, applied to search results instead of the
  // event stream. It is what stops the scan from calling completed work "dropped".
  const withEvidence = await mapLimit(classified, MODEL_CONCURRENCY, async ({ hit, extracted }) => {
    if (!extracted) return { hit, extracted, completed: false };
    const later = evidencePool.filter((e) => Number(e.ts) > Number(hit.ts));
    for (const e of later) {
      if (await fulfillment.isEvidenceOfFulfillment(extracted.summary, e.text)) {
        return { hit, extracted, completed: true };
      }
    }
    return { hit, extracted, completed: false };
  });

  let completed = 0;
  const byWork = new Map<string, ScanFinding>();
  for (const { hit: h, extracted, completed: done } of withEvidence) {
    if (!extracted) continue;
    if (done) {
      completed++;
      continue; // asked, and later proved finished. Not dropped.
    }

    const key = extracted.summary.toLowerCase().replace(/\s+/g, " ").trim();
    const seen = byWork.get(key);
    if (seen) {
      seen.occurrences++;
      seen.permalink ??= h.permalink;
      continue;
    }
    log(`  ⟲ RTS surfaced a dropped ${extracted.kind}: ${preview(extracted.summary)}`);
    byWork.set(key, {
      kind: extracted.kind,
      summary: extracted.summary,
      ownerId: extracted.ownerId,
      permalink: h.permalink,
      occurrences: 1,
    });
  }
  return { open: [...byWork.values()], completed, alreadyTracking };
}

app.event("app_mention", async ({ event, client, context, say }) => {
  const e = event as any;
  const c = client as WebClient;
  const channelId = e.channel;
  const threadTs = e.thread_ts ?? e.ts;
  const botUserId = (context as any)?.botUserId;

  // Verified in a live sandbox: Slack delivers the ephemeral RTS action_token at
  // event.assistant_thread.action_token on app_mention (not event.action_token,
  // as the RTS guide implies).
  const actionToken = e.assistant_thread?.action_token ?? e.action_token;
  const text: string = e.text ?? "";

  if (/\bscan\b/i.test(text)) {
    await say({ text: "Searching this channel's past for work that was already dropped...", thread_ts: threadTs });
    const { open, completed, alreadyTracking } = await scanChannel(c, channelId, actionToken, botUserId);

    // Say only what was actually checked. "Every ask was answered" is a claim about
    // evidence, so it is only made when evidence was genuinely found for each one.
    const context: string[] = [];
    if (completed) context.push(`${completed} ask${completed === 1 ? " that was" : "s that were"} later proved finished`);
    if (alreadyTracking) context.push(`${alreadyTracking} I'm already tracking`);
    const aside = context.length ? ` I also saw ${context.join(", and ")}.` : "";

    const disclaimer =
      `_Read-only briefing. Slack's Real-Time Search terms forbid storing retrieved data, so I keep none of this. ` +
      `Anything raised again in this channel, I'll start tracking for real._`;

    if (open.length === 0) {
      const nothing = completed || alreadyTracking
        ? `I searched the last ${SCAN_LOOKBACK_DAYS} days of this channel with Slack's Real-Time Search. Nothing is dropped.${aside} ✅`
        : `I searched the last ${SCAN_LOOKBACK_DAYS} days of this channel with Slack's Real-Time Search and couldn't find any asks at all.`;
      await say({ text: `${nothing}\n\n${disclaimer}`, thread_ts: threadTs });
      return;
    }

    const lines = open.slice(0, SCAN_MAX_REPORTED).map((f) => {
      const who = f.ownerId ? `promised by <@${f.ownerId}>` : "*nobody ever claimed it*";
      const again = f.occurrences > 1 ? ` · asked ${f.occurrences} times` : "";
      const link = f.permalink ? ` · <${f.permalink}|jump>` : "";
      return `• "${f.summary}" (${who})${again}${link}`;
    });
    await say({
      text:
        `I searched the last ${SCAN_LOOKBACK_DAYS} days of this channel with Slack's Real-Time Search and found ` +
        `*${open.length} open loop${open.length === 1 ? "" : "s"}* with no sign the work was ever done, ` +
        `from before I was even watching:\n${lines.join("\n")}\n${aside ? `\n_${aside.trim()}_\n` : ""}\n${disclaimer}`,
      thread_ts: threadTs,
    });
    return;
  }

  // Otherwise: answer "what's still open here?" from the authoritative ledger,
  // enriched with live RTS context when the platform gives us a token.
  let answer = ledgerAnswer(channelId);
  const hits = await searchContext(c, { actionToken, query: text || "open loops", channelId, limit: 5 });
  log(`RTS assistant.search.context -> ${hits.length} hit(s)`);
  if (hits.length) answer += `\n\n_Real-Time Search also surfaced ${hits.length} related message(s) in this channel._`;
  await say({ text: answer, thread_ts: threadTs });
});

// --- Deterministic timers: advance SLAs and act only on what changed ---------
const tickMs = cfg.demo ? 5_000 : 60_000;
setInterval(async () => {
  const now = Date.now();
  for (const loop of ledger.tick(now)) {
    log(`tick → ${loop.status}: ${preview(loop.summary)}`);
    try {
      if (loop.status === "DUE" || loop.status === "ESCALATED") {
        await upsertCard(app.client as WebClient, loop);
      } else if (loop.status === "BROKEN") {
        // Say exactly why it broke. The ledger guarantees a loop with a deadline
        // can't break before that deadline, so this copy is always true.
        const who = loop.ownerId ? `<@${loop.ownerId}> took this on and` : "Nobody ever claimed this,";
        const when = loop.dueAt ? "the deadline passed" : "the escalation window passed";
        await resolveCard(
          app.client as WebClient,
          loop.id,
          "🔴 Dropped — this never got done",
          `"${loop.summary}"\n${who} ${when}, and no message in this channel ever showed the work happened.`,
          "A deadline passing is not evidence. Loose Ends refuses to quietly mark this done, so a human can pick it back up.",
        );
      }
    } catch (err) {
      console.error("tick action failed", err);
    }
  }
}, tickMs);

// --- Boot --------------------------------------------------------------------
await app.start();

// Escalation to a backup human is the headline feature. Without a coordinator it
// silently pings nobody, which is exactly the kind of quiet no-op this project
// exists to hate. Say so loudly rather than pretending to work.
if (!cfg.coordinatorId) {
  console.error(
    "[loose-ends] WARNING: LOOSE_ENDS_COORDINATOR is not set. Unowned work will still " +
      "escalate, but no backup human will be @-mentioned. Set it to a Slack user id (U...).",
  );
}

console.error(
  `⚡ Loose Ends is live (${cfg.demo ? "DEMO timers ~5s" : "production timers"}), ` +
    `model=${cfg.llm.model}, ` +
    `watching ${cfg.watchedChannels.length ? cfg.watchedChannels.join(", ") : "all invited channels"}.`,
);
