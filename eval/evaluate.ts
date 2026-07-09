// The evaluation harness: the moat made measurable, and made honest.
//
// It runs an extractor over a labeled frontline corpus and reports precision,
// recall, the FALSE-POSITIVE RATE (how often the agent would have bothered
// someone about a non-loop), and a kind-accuracy figure for the request-vs-
// commitment split that competitors do not attempt.
//
// Two modes:
//   npm run eval       -> HeuristicExtractor (regex, offline). This is the
//                         ceiling of a weekend "detect a promise" clone. The
//                         corpus deliberately includes implied asks it can't see
//                         and "I'll be out Friday"-style traps it false-fires on,
//                         so this number is honest, not a tautology.
//   npm run eval:llm   -> LlmExtractor (real LLM). Needs OPENAI_API_KEY.
//                         This is where the AI earns its place: it recovers the
//                         phrasings the regex misses and rejects the traps.
//
// The delta between the two runs is the argument for the AI being load-bearing
// rather than bolted on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HeuristicExtractor, LlmExtractor, type Extractor } from "../src/extractor.ts";
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

async function pickExtractor(): Promise<{ name: string; extractor: Extractor }> {
  if (process.argv.includes("--llm")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const baseURL = process.env.LOOSE_ENDS_LLM_BASE_URL || undefined;
    const tz = Number(process.env.LOOSE_ENDS_TZ_OFFSET) || 0;

    // Same bring-your-own-model resolution as the app: OpenAI (or a local
    // endpoint) if present, else Anthropic.
    let settings: { provider: "openai" | "anthropic"; apiKey: string; model: string; baseURL?: string };
    if (openaiKey || baseURL) {
      settings = { provider: "openai", apiKey: openaiKey || "local", model: process.env.LOOSE_ENDS_MODEL || "gpt-4o-mini", baseURL };
    } else if (anthropicKey) {
      settings = { provider: "anthropic", apiKey: anthropicKey, model: process.env.LOOSE_ENDS_MODEL || "claude-haiku-4-5" };
    } else {
      console.error("--llm needs OPENAI_API_KEY or ANTHROPIC_API_KEY (or LOOSE_ENDS_LLM_BASE_URL). See .env.example.");
      process.exit(1);
    }
    // Dynamic import so the default heuristic run never loads an LLM SDK.
    const { createLlm } = await import("../src/llm.ts");
    return { name: `LlmExtractor (${settings.provider}: ${settings.model})`, extractor: new LlmExtractor(createLlm(settings), tz) };
  }
  return { name: "HeuristicExtractor (regex, offline)", extractor: new HeuristicExtractor() };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const corpus = loadCorpus();
const { name, extractor } = await pickExtractor();
const r = await evaluate(extractor, corpus);

console.log(`extractor:            ${name}`);
console.log(`corpus size:          ${corpus.length}`);
console.log(`precision:            ${pct(r.precision)}`);
console.log(`recall:               ${pct(r.recall)}`);
console.log(`false-positive rate:  ${pct(r.falsePositiveRate)}   <-- the demo number`);
console.log(`kind accuracy:        ${pct(r.kindAccuracy)}   (request vs commitment)`);
console.log(`confusion: tp=${r.tp} fp=${r.fp} tn=${r.tn} fn=${r.fn}`);
if (r.mistakes.length) {
  console.log("\nwhere this extractor is wrong:");
  for (const m of r.mistakes) console.log("  " + m);
}
