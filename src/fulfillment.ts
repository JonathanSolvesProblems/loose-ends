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
// storing results). A cheap deterministic gate keeps the LLM cost sane: we only
// ask Claude to confirm when a message even looks like a completion.

import type { LlmClassifier } from "./llm.ts";

/** Cheap signal that a message might be reporting completed work. */
const COMPLETION_SIGNAL =
  /\b(done|sent|filed|closed|finished|handled|complete[d]?|delivered|submitted|wrapped up|all set|took care of|reached out to|called|posted|shipped|paid)\b|✅|:white_check_mark:/i;

export function looksLikeCompletion(text: string): boolean {
  return COMPLETION_SIGNAL.test(text);
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
   * false fast for anything that doesn't even look like a completion, so the LLM
   * is only consulted on plausible evidence.
   */
  async isEvidenceOfFulfillment(loopSummary: string, candidateText: string): Promise<boolean> {
    if (!looksLikeCompletion(candidateText)) return false;
    const v = await this.llm.confirmsFulfillment(loopSummary, candidateText);
    return v.fulfilled && v.confidence >= this.minConfidence;
  }
}
