// Turning a messy Slack message into a structured open loop.
//
// The un-cloned target is the UNOWNED request: a message that asks for something
// without naming who will do it ("can someone follow up with the Diaz family?").
// Existing commitment bots only catch first-person promises; the unowned asks
// drop silently.
//
// Two extractors share one interface:
//   - HeuristicExtractor: regex signals, no API key. Runs the pipeline offline
//     (the demo and CI). It is NOT the moat and it deliberately misses subtle
//     phrasing, which is exactly what the eval shows and what the LLM recovers.
//   - LlmExtractor: the real one. A cheap deterministic NOISE filter drops
//     obvious social filler (guaranteeing silence + saving tokens), then Claude
//     makes the request-vs-commitment judgment on everything else.

import type { ExtractedLoop, IncomingMessage, LoopKind } from "./types.ts";
import type { LlmClassifier } from "./llm.ts";
import { groundDeadline } from "./dates.ts";

/** Phrases that look actionable but almost never are. Deterministic negative control. */
const SOFT_NOISE = [
  /\bi'?ll think about it\b/i,
  /\bwe should (grab|do|get) (lunch|coffee|drinks|together)\b/i,
  /\blet'?s circle back\b/i,
  /\bsometime\b/i,
  /\bno (rush|worries|pressure)\b/i,
  /\bjust (fyi|venting|thinking out loud)\b/i,
  /\bthanks (everyone|all|team)\b/i,
  /\b(great|good) (work|job) (this week|everyone|team)\b/i,
];

/** First-person future-action signals: a commitment with a known owner. */
const COMMIT_SIGNAL = [
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bi'?m going to\b/i,
  /\bi can (get|send|file|finish|handle|call|reach|take|cover)\b/i,
  /\bi'?ve got\b/i,
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
  /\bnobody (has|'s)? ?(picked|claimed|taken)\b/i,
  /\bcan we (get|make sure)\b/i,
];

export type PreFilterResult = { match: true; kind: LoopKind } | { match: false };

/** True when the message is obvious social filler the agent must never track. */
export function isSoftNoise(text: string): boolean {
  return SOFT_NOISE.some((re) => re.test(text));
}

/**
 * Signal-based classification used by the offline HeuristicExtractor. Conservative
 * on purpose. A commitment signal wins over a request signal when both fire (the
 * person already owns it).
 */
export function preFilter(text: string): PreFilterResult {
  if (isSoftNoise(text)) return { match: false };
  if (COMMIT_SIGNAL.some((re) => re.test(text))) return { match: true, kind: "commitment" };
  if (REQUEST_SIGNAL.some((re) => re.test(text))) return { match: true, kind: "request" };
  return { match: false };
}

export interface Extractor {
  /** Returns an extracted loop, or null if the message is not one. */
  extract(msg: IncomingMessage): Promise<ExtractedLoop | null>;
}

/**
 * Offline extractor: regex only, no network. Exists so the pipeline and eval run
 * with no API key. Intentionally simple; swap in LlmExtractor for real quality.
 */
export class HeuristicExtractor implements Extractor {
  private readonly tzOffsetMinutes: number;
  constructor(tzOffsetMinutes = 0) {
    this.tzOffsetMinutes = tzOffsetMinutes;
  }

  async extract(msg: IncomingMessage): Promise<ExtractedLoop | null> {
    const pf = preFilter(msg.text);
    if (!pf.match) return null;
    return {
      kind: pf.kind,
      summary: msg.text.trim().slice(0, 140),
      ownerId: pf.kind === "commitment" ? msg.userId : null,
      dueAt: groundDeadline(msg.text, msg.observedAt, this.tzOffsetMinutes),
      confidence: 0.7,
    };
  }
}

/**
 * The production extractor. Deterministic noise filter in front of a real Claude
 * classification call. The noise filter guarantees the agent stays silent on
 * filler (and cuts token spend); Claude does the nuanced judgment the regexes
 * cannot: request vs commitment, on phrasings a keyword filter would miss.
 */
export class LlmExtractor implements Extractor {
  private readonly llm: LlmClassifier;
  private readonly tzOffsetMinutes: number;
  /** Floor below which we don't even return a loop (the ledger also gates). */
  private readonly minConfidence: number;
  constructor(llm: LlmClassifier, tzOffsetMinutes = 0, minConfidence = 0.5) {
    this.llm = llm;
    this.tzOffsetMinutes = tzOffsetMinutes;
    this.minConfidence = minConfidence;
  }

  async extract(msg: IncomingMessage): Promise<ExtractedLoop | null> {
    // Deterministic negative control: never spend a token, never track filler.
    if (isSoftNoise(msg.text)) return null;

    const c = await this.llm.classify(msg.text, msg.userId);
    if (c.kind === "none" || c.confidence < this.minConfidence) return null;

    return {
      kind: c.kind,
      // A commitment is owned by its author; an open request has no owner yet.
      ownerId: c.kind === "commitment" ? msg.userId : null,
      summary: c.summary.trim().slice(0, 140) || msg.text.trim().slice(0, 140),
      dueAt: groundDeadline(c.dueText || msg.text, msg.observedAt, this.tzOffsetMinutes),
      confidence: c.confidence,
    };
  }
}
