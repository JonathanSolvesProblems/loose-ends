// The generative layer: turn a messy message into a structured commitment.
//
// Two pieces:
//  1. A cheap deterministic pre-filter that rejects obvious non-commitments before
//     spending an LLM call. This is also what keeps the false-positive rate low and
//     is measured by the eval harness.
//  2. An LLM extractor interface. The real implementation calls Slack AI / Claude;
//     the heuristic fallback below lets the whole pipeline run (and be evaluated)
//     with no API key, which is handy for the demo and for CI.

import type { ExtractedCommitment, IncomingMessage } from "./types.ts";

/** Phrases that look like commitments but almost never are. Tuned against eval/corpus.jsonl. */
const SOFT_NOISE = [
  /\bi'?ll think about it\b/i,
  /\bwe should (grab|do) (lunch|coffee|drinks)\b/i,
  /\blet'?s circle back\b/i,
  /\bsometime\b/i,
  /\bmaybe\b/i,
  /\bno (rush|worries)\b/i,
];

/** First-person future-action signals that suggest a real commitment. */
const COMMIT_SIGNAL = [
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bi'?m going to\b/i,
  /\bi can (get|send|file|finish|handle)\b/i,
  /\bon it\b/i,
  /\bwe'?ll (send|deliver|ship|file|get)\b/i,
];

/**
 * Returns true if the message is worth sending to the LLM at all.
 * Conservative on purpose: better to skip a borderline message than nag someone.
 */
export function passesPreFilter(text: string): boolean {
  if (SOFT_NOISE.some((re) => re.test(text))) return false;
  return COMMIT_SIGNAL.some((re) => re.test(text));
}

export interface Extractor {
  /** Returns an extracted commitment, or null if the message is not one. */
  extract(msg: IncomingMessage): Promise<ExtractedCommitment | null>;
}

/**
 * Heuristic extractor used when no LLM is wired up. It is intentionally simple and
 * is NOT the moat: it exists so the pipeline and eval harness run offline. Swap in
 * LlmExtractor for real quality.
 */
export class HeuristicExtractor implements Extractor {
  async extract(msg: IncomingMessage): Promise<ExtractedCommitment | null> {
    if (!passesPreFilter(msg.text)) return null;
    return {
      summary: msg.text.trim().slice(0, 120),
      ownerId: msg.userId,
      dueAt: this.guessDeadline(msg),
      confidence: 0.7,
    };
  }

  private guessDeadline(msg: IncomingMessage): number | null {
    // Real version grounds "by Friday", "EOD", "next week" against the message
    // timestamp and the workspace timezone. Left as a stub here.
    return /\b(by|before|eod|tomorrow|friday|monday|next week)\b/i.test(msg.text)
      ? msg.observedAt + 3 * 24 * 60 * 60 * 1000
      : null;
  }
}

/**
 * The production extractor. Sends the message to Slack AI / Claude with a strict
 * JSON schema and the same pre-filter in front of it to save tokens.
 *
 * TODO(week2): implement against the model endpoint exposed to the Slack agent.
 * Keep the pre-filter; tune SOFT_NOISE / COMMIT_SIGNAL from eval results.
 */
export class LlmExtractor implements Extractor {
  private readonly call: (prompt: string) => Promise<string>;
  constructor(call: (prompt: string) => Promise<string>) {
    this.call = call;
  }

  async extract(msg: IncomingMessage): Promise<ExtractedCommitment | null> {
    if (!passesPreFilter(msg.text)) return null;
    const raw = await this.call(buildPrompt(msg));
    const parsed = safeParse(raw);
    if (!parsed || !parsed.summary || typeof parsed.confidence !== "number") return null;
    return parsed;
  }
}

function buildPrompt(msg: IncomingMessage): string {
  return [
    "You extract actionable commitments from a single Slack message.",
    "A commitment is a first-person promise to do a specific thing.",
    'Rhetorical or social filler ("we should grab lunch", "I\'ll think about it") is NOT a commitment.',
    "Return JSON: {summary, ownerId, dueAt (epoch ms or null), confidence 0..1}.",
    `ownerId is ${msg.userId}. Message observed at ${msg.observedAt}.`,
    `Message: ${JSON.stringify(msg.text)}`,
  ].join("\n");
}

function safeParse(raw: string): ExtractedCommitment | null {
  try {
    return JSON.parse(raw) as ExtractedCommitment;
  } catch {
    return null;
  }
}
