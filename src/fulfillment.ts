// Evidence-based fulfillment detection: the moat, and the demo's flagship beat.
//
// Every existing commitment bot marks a loop "done" when a timer runs out or the
// owner taps a button. Loose Ends does something none of them do: it watches the
// live conversation for a later message that is actual EVIDENCE the work landed
// ("closed out the Diaz housing case", "report sent to the funder") and only
// then closes the loop. A deadline passing with no evidence keeps the loop OPEN,
// because "closed" is not "done" (the whole reason a served-person safety net
// exists: a referral marked closed where the client never got the service).
//
// This reads from the same Events API push stream the extractor does, so it does
// NOT re-scan channel history (throttled) and does NOT use RTS (which forbids
// storing results).
//
// THE TWO ERRORS ARE NOT SYMMETRIC, and the design leans hard on that:
//   - A FALSE VERIFY (closing work that never happened) is the exact harm this
//     project exists to prevent. It must be near zero.
//   - A MISSED PROOF (not noticing real evidence) is safe: the loop stays open and
//     a human still sees it.
// So the cheap gate below is deliberately GENEROUS (a false gate-in only costs one
// token), and the model is the conservative precision layer that actually decides.
//
// The gate admits a message if it either sounds like a completion OR talks about
// the same subject as the loop. Keyword-only gating was measurably wrong: it threw
// away "the Diaz family has their voucher now" and "budget draft is in your inbox"
// before the model could ever judge them (see eval/evaluate-fulfillment.ts).

import type { LlmClassifier } from "./llm.ts";

/** Cheap signal that a message might be reporting completed work. */
const COMPLETION_SIGNAL =
  /\b(done|sent|filed|closed|finished|handled|complete[d]?|delivered|submitted|wrapped up|all set|took care of|reached out to|called|posted|shipped|paid)\b|✅|:white_check_mark:/i;

export function looksLikeCompletion(text: string): boolean {
  return COMPLETION_SIGNAL.test(text);
}

const STOPWORDS = new Set([
  "the", "this", "that", "with", "from", "about", "their", "there", "they", "them",
  "have", "has", "had", "will", "would", "should", "could", "been", "being", "were",
  "what", "when", "which", "while", "your", "yours", "ours", "into", "over", "back",
  "then", "than", "some", "just", "still", "need", "needs", "make", "made", "does",
  "before", "after", "please", "thanks", "sorry", "going", "want", "wants",
]);

/** Content words: long enough to mean something, not stopwords. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Loose match so "onboard"/"onboarded" and "confirm"/"confirmed" count. */
function related(a: string, b: string): boolean {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * Does this message talk about the same thing the loop is about? Generous on
 * purpose: gating a non-completion in only costs one model call, whereas gating a
 * real completion OUT means the loop nags a human who already did the work.
 */
export function sharesSubject(loopSummary: string, text: string): boolean {
  const subject = contentWords(loopSummary);
  const words = contentWords(text);
  return subject.some((s) => words.some((w) => related(s, w)));
}

/** Should the model be asked to judge this message against this loop at all? */
export function isWorthChecking(loopSummary: string, candidateText: string): boolean {
  return looksLikeCompletion(candidateText) || sharesSubject(loopSummary, candidateText);
}

export class FulfillmentDetector {
  private readonly llm: LlmClassifier;
  /** Minimum model confidence before we call a loop fulfilled on evidence. */
  private readonly minConfidence: number;
  constructor(llm: LlmClassifier, minConfidence = 0.6) {
    this.llm = llm;
    this.minConfidence = minConfidence;
  }

  /**
   * Does `candidateText` show that `loopSummary` was actually completed? Returns
   * false fast for anything unrelated, so the model is only consulted on messages
   * that plausibly bear on this specific loop.
   */
  async isEvidenceOfFulfillment(loopSummary: string, candidateText: string): Promise<boolean> {
    if (!isWorthChecking(loopSummary, candidateText)) return false;
    const v = await this.llm.confirmsFulfillment(loopSummary, candidateText);
    return v.fulfilled && v.confidence >= this.minConfidence;
  }
}
