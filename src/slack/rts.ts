// The Real-Time Search (RTS) API adapter — used where it is genuinely load-bearing.
//
// RTS is a request/response query API, not a passive stream: bot calls need an
// ephemeral action_token that only arrives on a mention or DM, and results must
// not be stored. So RTS is NOT how Loose Ends watches channels (that's the Events
// API). What RTS uniquely enables is RETROACTIVE DISCOVERY: when a coordinator
// @-mentions the agent, we can search the channel's past for asks that were
// dropped BEFORE the agent was ever installed, or while it was offline.
//
// This is impossible any other way: conversations.history is throttled to 1
// request/minute (max 15 objects) for non-Marketplace apps, so a real backfill
// via history is unusable. Delete RTS and Loose Ends loses the ability to see
// anything that happened before it was watching.
//
// VERIFIED EMPIRICALLY (sandbox, 2026-07-09): the action_token arrives at
// `event.assistant_thread.action_token` on app_mention — NOT at
// `event.action_token` as the RTS guide implies.
//
// COMPLIANCE, verbatim from Slack's RTS docs:
//   "You must not store or copy any of the data retrieved from this API."
//   "You may not use this API to scrape data in a workspace that is unrelated to
//    user queries."
//   It is "intended to be used in response to user interactions."
// So RTS here is strictly a read-only, user-invoked briefing. A hit is held in
// memory only long enough to classify it, then discarded. NOTHING derived from an
// RTS result is ever written to the ledger. The ledger is fed exclusively by the
// Events API, which carries no such restriction.

import type { WebClient } from "@slack/web-api";

export interface RtsHit {
  /** Slack message ts — also the stable message id, so the ledger can dedupe. */
  ts: string;
  channelId: string;
  text: string;
  permalink?: string;
  authorId?: string;
}

export interface SearchOptions {
  /** Ephemeral, per-interaction. From event.assistant_thread.action_token. */
  actionToken: string | undefined;
  query: string;
  /** Soft scope only — Slack may return hits from other channels. Always re-filter. */
  channelId: string;
  afterEpochSec?: number;
  beforeEpochSec?: number;
  limit?: number;
}

let loggedShape = false;

/**
 * Query RTS. Returns [] on any failure so the caller degrades gracefully.
 * Bot-token RTS is public-channel only (search:read.public).
 */
export async function searchContext(client: WebClient, opts: SearchOptions): Promise<RtsHit[]> {
  if (!opts.actionToken) {
    console.error("[loose-ends] RTS skipped: no action_token on this event");
    return [];
  }
  try {
    const params: Record<string, unknown> = {
      query: opts.query,
      action_token: opts.actionToken,
      channel_types: "public_channel",
      content_types: "messages",
      context_channel_id: opts.channelId,
      limit: opts.limit ?? 20,
    };
    if (opts.afterEpochSec) params.after = opts.afterEpochSec;
    if (opts.beforeEpochSec) params.before = opts.beforeEpochSec;

    const res: any = await client.apiCall("assistant.search.context", params);
    const raw: any[] = res?.results?.messages ?? res?.messages ?? [];

    // One-time shape probe: Slack's response field names aren't fully documented.
    if (!loggedShape && raw.length) {
      console.error(`[loose-ends] RTS response keys: [${Object.keys(res).join(", ")}]`);
      console.error(`[loose-ends] RTS hit keys: [${Object.keys(raw[0]).join(", ")}]`);
      loggedShape = true;
    }

    return raw.map((m) => ({
      // Defensive across field-name variants until the shape is pinned down.
      ts: String(m.ts ?? m.message_ts ?? m.timestamp ?? ""),
      channelId: String(m.channel?.id ?? m.channel_id ?? m.channel ?? ""),
      text: String(m.text ?? m.content ?? ""),
      permalink: m.permalink,
      authorId: m.author_user_id ?? m.user ?? m.user_id,
    }));
  } catch (err: any) {
    // Surface WHY, so a missing scope / wrong param / bad token is diagnosable
    // instead of silently degrading to the ledger answer.
    console.error(`[loose-ends] RTS assistant.search.context failed: ${err?.data?.error ?? err?.message ?? err}`);
    return [];
  }
}
