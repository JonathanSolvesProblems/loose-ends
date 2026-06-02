// The evaluation harness: this is the moat made measurable.
//
// It runs the extractor over a labeled corpus and reports the numbers you put on
// screen in the demo: precision, recall, and above all the FALSE-POSITIVE RATE
// (how often the agent would have nagged someone about a non-commitment). A weekend
// clone has no number here; you do.
//
// Run: npm run eval

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HeuristicExtractor, type Extractor } from "../src/extractor.ts";
import type { CorpusRow, IncomingMessage } from "../src/types.ts";

function loadCorpus(): CorpusRow[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "corpus.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CorpusRow);
}

async function evaluate(extractor: Extractor, corpus: CorpusRow[]) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mistakes: string[] = [];

  for (const row of corpus) {
    const msg: IncomingMessage = {
      channelId: "EVAL", ts: "0", userId: "U_EVAL", text: row.text, observedAt: 0,
    };
    const predicted = (await extractor.extract(msg)) !== null;
    if (predicted && row.isCommitment) tp++;
    else if (predicted && !row.isCommitment) { fp++; mistakes.push(`FALSE POSITIVE: ${row.text}`); }
    else if (!predicted && !row.isCommitment) tn++;
    else { fn++; mistakes.push(`MISSED: ${row.text}`); }
  }

  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const negatives = fp + tn;
  const falsePositiveRate = negatives ? fp / negatives : 0;

  return { tp, fp, tn, fn, precision, recall, falsePositiveRate, mistakes };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const corpus = loadCorpus();
const r = await evaluate(new HeuristicExtractor(), corpus);

console.log(`corpus size:          ${corpus.length}`);
console.log(`precision:            ${pct(r.precision)}`);
console.log(`recall:               ${pct(r.recall)}`);
console.log(`false-positive rate:  ${pct(r.falsePositiveRate)}   <-- the demo number`);
console.log(`confusion: tp=${r.tp} fp=${r.fp} tn=${r.tn} fn=${r.fn}`);
if (r.mistakes.length) {
  console.log("\nmistakes to fix:");
  for (const m of r.mistakes) console.log("  " + m);
}
