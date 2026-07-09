// Runtime configuration, read once from the environment.
//
// Nothing in this repo hardcodes a secret. Every credential and tuning knob
// comes from process.env (see .env.example). The core logic (ledger, extractor,
// dates) never imports this file; only the Slack app wiring does. That keeps the
// deterministic pieces pure and testable without any environment at all.

import type { LedgerConfig } from "./ledger.ts";

export interface SlackCreds {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export interface LlmSettings {
  apiKey: string;
  model: string;
  /** OpenAI-compatible base URL override (e.g. a local Ollama at :11434/v1). */
  baseURL?: string;
}

export interface AppConfig {
  slack: SlackCreds;
  /** The AI judgment layer. Bring-your-own-model; the challenge mandates no vendor. */
  llm: LlmSettings;
  /** Channel ids the agent may watch. Empty => every channel the bot is in. */
  watchedChannels: string[];
  /** The backup human unowned/overdue loops escalate to. */
  coordinatorId: string;
  /** Optional Slack List id for governed write-back; empty => skip List writes. */
  listId: string;
  /** Minutes offset from UTC used to ground natural-language deadlines. */
  tzOffsetMinutes: number;
  /** Deterministic ledger timings (shrunk in demo mode). */
  ledger: LedgerConfig;
  /** True when LOOSE_ENDS_DEMO=1: timers run in seconds so escalations show live. */
  demo: boolean;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Resolve the model. The API is OpenAI-compatible, so LOOSE_ENDS_LLM_BASE_URL
 * points this at a local endpoint (Ollama, LM Studio) for a zero-cost, fully
 * offline run, in which case no cloud key is needed.
 */
function resolveLlm(): LlmSettings {
  const baseURL = process.env.LOOSE_ENDS_LLM_BASE_URL?.trim() || undefined;
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseURL ? "local" : "");
  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY (or LOOSE_ENDS_LLM_BASE_URL for a local model). See .env.example.");
  }
  return { apiKey, model: process.env.LOOSE_ENDS_MODEL?.trim() || "gpt-4o-mini", baseURL };
}

/** Read and validate the full app config. Throws if a required var is missing. */
export function loadConfig(): AppConfig {
  const demo = process.env.LOOSE_ENDS_DEMO === "1" || process.env.LOOSE_ENDS_DEMO === "true";

  // Demo mode makes the safety net visible on camera: an unowned request
  // escalates after ~15s instead of 4h. Production timings are the defaults.
  const ledger: LedgerConfig = demo
    ? { responseSlaMs: 15_000, graceMs: 15_000, escalationGraceMs: 15_000, minConfidence: 0.6 }
    : {
        responseSlaMs: intEnv("LOOSE_ENDS_RESPONSE_SLA_MIN", 240) * MIN, // 4h default
        graceMs: intEnv("LOOSE_ENDS_GRACE_MIN", 24 * 60) * MIN, // 24h default
        escalationGraceMs: intEnv("LOOSE_ENDS_ESCALATION_GRACE_MIN", 24 * 60) * MIN,
        minConfidence: 0.6,
      };

  return {
    slack: {
      botToken: req("SLACK_BOT_TOKEN"),
      appToken: req("SLACK_APP_TOKEN"),
      signingSecret: req("SLACK_SIGNING_SECRET"),
    },
    llm: resolveLlm(),
    watchedChannels: (process.env.LOOSE_ENDS_CHANNELS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    coordinatorId: process.env.LOOSE_ENDS_COORDINATOR?.trim() || "",
    listId: process.env.LOOSE_ENDS_LIST_ID?.trim() || "",
    tzOffsetMinutes: intEnv("LOOSE_ENDS_TZ_OFFSET", 0),
    ledger,
    demo,
  };
}

export { HOUR, MIN };
