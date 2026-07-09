// Rendering a LoopCard into Slack Block Kit. Kept as pure data-in/data-out so it
// can be unit-tested without a workspace. The UX restraint of the product lives
// here: calm, single-line cards with at most a few one-tap buttons, never a
// wall of text and never a channel spam.
//
// Two rules learned from watching real cards land in a channel:
//   1. Always say WHY the agent spoke up (the `reason` context line). A bot that
//      appears without explaining itself reads as noise.
//   2. Never make a human do date math. Render deadlines with Slack's native
//      <!date^...> token so everyone sees it in their own timezone.

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

const STATUS_EMOJI: Record<string, string> = {
  UNOWNED: "🟡",
  DUE: "🟡",
  ESCALATED: "🔴",
  BROKEN: "🔴",
  FULFILLED: "✅",
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

/** Slack renders this in each viewer's own timezone. Never hand-format a date. */
export function slackDate(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const fallback = `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `<!date^${secs}^{date_short_pretty} at {time}|${fallback}>`;
}

/**
 * Render an actionable card. `mentionUserId` is the person who should actually
 * act (the owner for a due nudge, the backup human for an escalation); putting
 * the mention inside the blocks is what makes Slack notify them.
 */
export function renderCard(card: LoopCard, mentionUserId?: string): RenderedMessage {
  const emoji = STATUS_EMOJI[card.status] ?? "🟡";
  const mention = mentionUserId ? `<@${mentionUserId}> ` : "";

  const lines = [`${emoji} ${mention}*${card.headline}*`, card.detail];
  const facts: string[] = [];
  if (card.ownerId) facts.push(`Owner: <@${card.ownerId}>`);
  if (card.dueAt) facts.push(`Due ${slackDate(card.dueAt)}`);
  if (facts.length) lines.push(facts.join("  ·  "));

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    { type: "context", elements: [{ type: "mrkdwn", text: card.reason }] },
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
  return { text: `${card.headline} — ${card.detail}`, blocks };
}

/**
 * Render the terminal state after a loop resolves (claimed / verified / broken).
 * `note` is the small grey line that explains what the status actually means.
 */
export function renderResolved(headline: string, detail: string, note?: string): RenderedMessage {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: `*${headline}*\n${detail}` } }];
  if (note) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
  return { text: `${headline} — ${detail}`, blocks };
}
