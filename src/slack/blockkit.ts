// Rendering a LoopCard into Slack Block Kit. Kept as pure data-in/data-out so it
// can be unit-tested without a workspace. The UX restraint of the product lives
// here: calm, single-line cards with at most a few one-tap buttons, never a
// wall of text and never a channel spam.

import type { LoopCard, ReviewDecision } from "../actions.ts";

const ACTION_LABELS: Record<string, string> = {
  claim: "Claim it",
  approve: "Mark done",
  snooze: "Snooze 1d",
  dismiss: "Not a loop",
};

const ACTION_STYLE: Record<string, "primary" | "danger" | undefined> = {
  claim: "primary",
  approve: "primary",
  snooze: undefined,
  dismiss: "danger",
};

export interface RenderedMessage {
  text: string; // notification fallback
  blocks: unknown[];
}

/** action_id we register the interaction handler on. */
export const ACTION_ID = "loose_ends_review";

/** Encode which loop + which decision a button carries. */
export function encodeAction(loopId: string, kind: ReviewDecision["kind"]): string {
  return JSON.stringify({ loopId, kind });
}

export function decodeAction(value: string): { loopId: string; kind: ReviewDecision["kind"] } | null {
  try {
    const v = JSON.parse(value);
    if (typeof v?.loopId === "string" && typeof v?.kind === "string") return v;
  } catch {
    /* fall through */
  }
  return null;
}

const EMOJI: Record<string, string> = {
  "Nobody has picked this up": "🔴",
  "This needs an owner": "🟡",
  "This looks dropped": "🔴",
  "Heads up, this is due": "🟡",
};

/** Render an actionable card. */
export function renderCard(card: LoopCard): RenderedMessage {
  const emoji = EMOJI[card.headline] ?? "🟡";
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${emoji} *${card.headline}*\n${card.detail}` },
    },
    {
      type: "actions",
      block_id: `le_${card.loopId}`,
      elements: card.actions.map((a) => ({
        type: "button",
        text: { type: "plain_text", text: ACTION_LABELS[a] ?? a },
        ...(ACTION_STYLE[a] ? { style: ACTION_STYLE[a] } : {}),
        action_id: `${ACTION_ID}:${a}`,
        value: encodeAction(card.loopId, a as ReviewDecision["kind"]),
      })),
    },
  ];
  if (card.permalink) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<${card.permalink}|Jump to the message>` }],
    });
  }
  return { text: card.headline, blocks };
}

/** Render the terminal state after a reviewer acts (replaces the card's buttons). */
export function renderResolved(headline: string, detail: string): RenderedMessage {
  return {
    text: headline,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${headline}*\n${detail}` } }],
  };
}
