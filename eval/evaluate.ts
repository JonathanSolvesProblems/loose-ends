// The evaluation harness: this is the moat made measurable.
//
// It runs the extractor over a labeled corpus and reports the numbers you put on
// screen in the demo: precision, recall, the FALSE-POSITIVE RATE (how often the
// agent would have bothered someone about a non-loop), and a kind-accuracy figure
// for the request-vs-commitment split that competitors do not attempt. A weekend
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
  let kindRight = 0, kindTotal = 0;
  const mistakes: string[] = [];

  for (const row of corpus) {
    const msg: IncomingMessage = {
      channelId: "EVAL", ts: "0", userId: "U_EVAL", text: row.text, observedAt: 0,
    };
    const out = await extractor.extract(msg);
    const predicted = out !== null;

    if (predicted && row.isOpenLoop) {
      tp++;
      if (row.kind) {
        kindTotal++;
        if (out!.kind === row.kind) kindRight++;
        else mistakes.push(`KIND: "${row.text}" -> got ${out!.kind}, want ${row.kind}`);
      }
    } else if (predicted && !row.isOpenLoop) {
      fp++;
      mistakes.push(`FALSE POSITIVE: ${row.text}`);
    } else if (!predicted && !row.isOpenLoop) {
      tn++;
    } else {
      fn++;
      mistakes.push(`MISSED: ${row.text}`);
    }
  }

  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const negatives = fp + tn;
  const falsePositiveRate = negatives ? fp / negatives : 0;
  const kindAccuracy = kindTotal ? kindRight / kindTotal : 1;

  return { tp, fp, tn, fn, precision, recall, falsePositiveRate, kindAccuracy, mistakes };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const corpus = loadCorpus();
const r = await evaluate(new HeuristicExtractor(), corpus);

console.log(`corpus size:          ${corpus.length}`);
console.log(`precision:            ${pct(r.precision)}`);
console.log(`recall:               ${pct(r.recall)}`);
console.log(`false-positive rate:  ${pct(r.falsePositiveRate)}   <-- the demo number`);
console.log(`kind accuracy:        ${pct(r.kindAccuracy)}   (request vs commitment)`);
console.log(`confusion: tp=${r.tp} fp=${r.fp} tn=${r.tn} fn=${r.fn}`);
if (r.mistakes.length) {
  console.log("\nmistakes to fix:");
  for (const m of r.mistakes) console.log("  " + m);
}
