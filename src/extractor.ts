// The generative layer: turn a messy message into a structured open loop.
//
// The un-cloned target is the UNOWNED request: a message that asks for something
// without naming who will do it ("can someone follow up with the Diaz family?").
// Existing commitment bots only catch first-person promises; those drop silently.
//
// Two pieces:
//  1. A cheap deterministic pre-filter that rejects obvious noise before spending
//     an LLM call. This is also what keeps the false-positive rate low and is
//     measured by the eval harness.
//  2. An LLM extractor interface. The real implementation calls Slack AI / Claude;
//     the heuristic fallback lets the whole pipeline run (and be evaluated) with
//     no API key, which is handy for the demo and CI.

import type { ExtractedLoop, IncomingMessage, LoopKind } from "./types.ts";

/** Phrases that look actionable but almost never are. Tuned against eval/corpus.jsonl. */
const SOFT_NOISE = [
  /\bi'?ll think about it\b/i,
  /\bwe should (grab|do) (lunch|coffee|drinks)\b/i,
  /\blet'?s circle back\b/i,
  /\bsometime\b/i,
  /\bno (rush|worries|pressure)\b/i,
  /\bjust (fyi|venting|thinking out loud)\b/i,
];

/** First-person future-action signals: a commitment with a known owner. */
const COMMIT_SIGNAL = [
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bi'?m going to\b/i,
  /\bi can (get|send|file|finish|handle|call|reach)\b/i,
  /\bon it\b/i,
  /\bwe'?ll (send|deliver|ship|file|get|call|follow)\b/i,
];

/** Open-request signals: something is being asked, owner not yet named. */
const REQUEST_SIGNAL = [
  /\bcan (someone|anyone|somebody)\b/i,
  /\b(who can|who's able to|who is able to|who wants to)\b/i,
  /\bcould (someone|anyone|we)\b/i,
  /\bwe need (someone|to)\b/i,
  /\b(needs|requires) (a )?follow[- ]?up\b/i,
  /\bnobody (has|'s) (picked|claimed|taken)\b/i,
  /\bcan we (get|make sure)\b/i,
];

export type PreFilterResult = { match: true; kind: LoopKind } | { match: false };

/**
 * Classify a message cheaply before any LLM call. Conservative on purpose:
 * better to skip a borderline message than to nag someone. A commitment signal
 * wins over a request signal when both fire (the person already owns it).
 */
export function preFilter(text: string): PreFilterResult {
  if (SOFT_NOISE.some((re) => re.test(text))) return { match: false };
  if (COMMIT_SIGNAL.some((re) => re.test(text))) return { match: true, kind: "commitment" };
  if (REQUEST_SIGNAL.some((re) => re.test(text))) return { match: true, kind: "request" };
  return { match: false };
}

export interface Extractor {
  /** Returns an extracted loop, or null if the message is not one. */
  extract(msg: IncomingMessage): Promise<ExtractedLoop | null>;
}

/**
 * Heuristic extractor used when no LLM is wired up. Intentionally simple and NOT
 * the moat: it exists so the pipeline and eval harness run offline. Swap in
 * LlmExtractor for real quality.
 */
export class HeuristicExtractor implements Extractor {
  async extract(msg: IncomingMessage): Promise<ExtractedLoop | null> {
    const pf = preFilter(msg.text);
    if (!pf.match) return null;
    return {
      kind: pf.kind,
      summary: msg.text.trim().slice(0, 120),
      // A commitment is owned by its author; an open request has no owner yet.
      ownerId: pf.kind === "commitment" ? msg.userId : null,
      dueAt: this.guessDeadline(msg),
      confidence: 0.7,
    };
  }

  private guessDeadline(msg: IncomingMessage): number | null {
    // Real version grounds "by Friday", "EOD", "next week" against the message
    // timestamp and the workspace timezone. Left as a stub here.
    return /\b(by|before|eod|tomorrow|today|friday|monday|next week)\b/i.test(msg.text)
      ? msg.observedAt + 3 * 24 * 60 * 60 * 1000
      : null;
  }
}

/**
 * The production extractor. Sends the message to Slack AI / Claude with a strict
 * JSON schema and the same pre-filter in front of it to save tokens.
 *
 * TODO(week2): implement against the model endpoint exposed to the Slack agent.
 * Keep the pre-filter; tune SOFT_NOISE / COMMIT_SIGNAL / REQUEST_SIGNAL from eval.
 */
export class LlmExtractor implements Extractor {
  private readonly call: (prompt: string) => Promise<string>;
  constructor(call: (prompt: string) => Promise<string>) {
    this.call = call;
  }

  async extract(msg: IncomingMessage): Promise<ExtractedLoop | null> {
    if (!preFilter(msg.text).match) return null;
    const raw = await this.call(buildPrompt(msg));
    const parsed = safeParse(raw);
    if (!parsed || !parsed.summary || typeof parsed.confidence !== "number") return null;
    return parsed;
  }
}

function buildPrompt(msg: IncomingMessage): string {
  return [
    "You extract actionable open loops from a single Slack message.",
    "An open loop is either:",
    '  - "commitment": a first-person promise to do a specific thing (owner is the author).',
    '  - "request": an ask for something where the owner is not yet named (ownerId null).',
    'Rhetorical or social filler ("we should grab lunch", "I\'ll think about it", "no rush") is NOT a loop.',
    "Return JSON: {kind, summary, ownerId (string or null), dueAt (epoch ms or null), confidence 0..1}.",
    `Author is ${msg.userId}. Message observed at ${msg.observedAt}.`,
    `Message: ${JSON.stringify(msg.text)}`,
  ].join("\n");
}

function safeParse(raw: string): ExtractedLoop | null {
  try {
    return JSON.parse(raw) as ExtractedLoop;
  } catch {
    return null;
  }
}
