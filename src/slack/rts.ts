// The Real-Time Search (RTS) API adapter — used the way RTS actually works.
//
// IMPORTANT design correction: RTS is a request/response query API, not a
// passive stream. Its bot calls require an ephemeral action_token that only
// arrives when the app is @-mentioned or DM'd, and it forbids storing results.
// So RTS is NOT how Loose Ends watches channels (that's the Events API). RTS is
// used here for exactly what it's for: an on-demand, user-invoked lookup. When a
// coordinator asks the agent "what's still open here?", we call
// assistant.search.context to pull fresh in-channel context around their
// question, alongside the authoritative answer from our own deterministic ledger.
//
// Authoritative open-loop state always comes from the ledger; RTS is the live
// "search the real channel" flourish and the eligible-technology usage. If RTS
// is unavailable (no action_token, feature not enabled), the ledger answer still
// stands on its own.

import type { WebClient } from "@slack/web-api";

export interface RtsHit {
  text: string;
  permalink?: string;
  authorId?: string;
}

/**
 * Query RTS for messages relevant to `query` in `channelId`. Returns [] on any
 * failure so the caller can fall back to the ledger. `actionToken` comes from the
 * assistant/mention event that triggered the lookup.
 */
export async function searchContext(
  client: WebClient,
  actionToken: string | undefined,
  query: string,
  channelId: string,
  limit = 10,
): Promise<RtsHit[]> {
  if (!actionToken) return [];
  try {
    const res: any = await client.apiCall("assistant.search.context", {
      query,
      action_token: actionToken,
      channel_types: "public_channel,private_channel",
      content_types: "messages",
      context_channel_id: channelId,
      limit,
    });
    const results = res?.results?.messages ?? res?.messages ?? [];
    return (results as any[]).map((m) => ({
      text: m.text ?? m.content ?? "",
      permalink: m.permalink,
      authorId: m.author_user_id ?? m.user,
    }));
  } catch {
    return [];
  }
}
