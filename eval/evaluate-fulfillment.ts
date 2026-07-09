// Measuring the moat.
//
// Evidence-based fulfillment verification is the one thing no other tool does, and
// it is also the easiest thing to get quietly wrong. So it gets its own corpus and
// its own number. Extraction accuracy (eval/evaluate.ts) says nothing about this.
//
// The two errors are NOT symmetric:
//
//   FALSE VERIFY (fp) - the agent marks work done that never happened. This is the
//       exact failure Loose Ends exists to prevent. A referral marked "closed" that
//       never reached the client. This error must be near zero.
//   MISSED PROOF (fn) - the agent fails to notice real evidence, so the loop stays
//       open and a human sees it. Annoying, but SAFE. Nobody gets dropped.
//
// So we optimise for precision on "done", and we report the false-verify rate as
// the headline. A keyword-only verifier cannot make this distinction at all: it
// happily closes the Diaz case when someone says "closed out the Ramirez case".
//
// Run:
//   npm run eval:fulfillment       -> keyword baseline (offline, no key)
//   npm run eval:fulfillment:llm   -> the real detector (needs OPENAI_API_KEY)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { looksLikeCompletion } from "../src/fulfillment.ts";

interface Row {
  loop: string;
  candidate: string;
  fulfilled: boolean;
  note?: string;
}

type Verifier = (loop: string, candidate: string) => Promise<boolean>;

function loadCorpus(): Row[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "fulfillment.jsonl"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
}

/** What a naive bot does: any completion-sounding word closes the loop. */
const keywordVerifier: Verifier = async (_loop, candidate) => looksLikeCompletion(candidate);

async function pickVerifier(): Promise<{ name: string; verify: Verifier }> {
  if (!process.argv.includes("--llm")) {
    return { name: "keyword baseline (offline)", verify: keywordVerifier };
  }
  const baseURL = process.env.LOOSE_ENDS_LLM_BASE_URL || undefined;
  const apiKey = process.env.OPENAI_API_KEY || (baseURL ? "local" : "");
  if (!apiKey) {
    console.error("--llm needs OPENAI_API_KEY (or LOOSE_ENDS_LLM_BASE_URL for a local model). See .env.example.");
    process.exit(1);
  }
  const model = process.env.LOOSE_ENDS_MODEL || "gpt-4o-mini";
  const { createLlm } = await import("../src/llm.ts");
  const { FulfillmentDetector } = await import("../src/fulfillment.ts");
  const detector = new FulfillmentDetector(createLlm({ apiKey, model, baseURL }));
  return {
    name: `evidence detector (${model})`,
    verify: (loop, candidate) => detector.isEvidenceOfFulfillment(loop, candidate),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const corpus = loadCorpus();
const { name, verify } = await pickVerifier();

let tp = 0, fp = 0, tn = 0, fn = 0;
const falseVerifies: string[] = [];
const missedProof: string[] = [];

for (const row of corpus) {
  const said = await verify(row.loop, row.candidate);
  if (said && row.fulfilled) tp++;
  else if (said && !row.fulfilled) {
    fp++;
    falseVerifies.push(`"${row.candidate}"  (loop: ${row.loop})`);
  } else if (!said && !row.fulfilled) tn++;
  else {
    fn++;
    missedProof.push(`"${row.candidate}"  (loop: ${row.loop})`);
  }
}

const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
const negatives = fp + tn;
const falseVerifyRate = negatives ? fp / negatives : 0;

console.log(`verifier:             ${name}`);
console.log(`corpus size:          ${corpus.length}`);
console.log(`precision on "done":  ${pct(precision)}`);
console.log(`recall of real proof: ${pct(recall)}`);
console.log(`FALSE-VERIFY RATE:    ${pct(falseVerifyRate)}   <-- marking work done that never happened`);
console.log(`confusion: tp=${tp} fp=${fp} tn=${tn} fn=${fn}`);

if (falseVerifies.length) {
  console.log(`\nDANGEROUS (closed a loop that was not done):`);
  for (const m of falseVerifies) console.log("  " + m);
}
if (missedProof.length) {
  console.log(`\nSafe misses (loop stays open, a human still sees it):`);
  for (const m of missedProof) console.log("  " + m);
}
