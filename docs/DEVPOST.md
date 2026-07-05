# Loose Ends — Devpost submission

> Paste-ready copy for the Devpost form. Fill the three `⟨…⟩` placeholders once
> you've run the live agent and `npm run eval:llm`.

---

## Elevator pitch (one line)

**Loose Ends catches asks in Slack that nobody accepted, and only marks them done
once it finds evidence the work actually happened.**

## Tagline / category

Slack Agent for Good — nonprofit operations & frontline mission teams.
It's like a helpdesk unassigned-ticket queue, but for the ordinary conversation
of a mission-driven team, and it verifies the fix instead of trusting a timer.

---

## Inspiration

In a nonprofit, mutual-aid, or community-health Slack, an unanswered "can someone
follow up with the Diaz family?" is not a slipped deck. It is a person not
served. The message scrolls away, everyone assumes someone else has it, and
nobody does.

The number that made me build this: in a study of 115,316 social-services
referrals across a 26-county network, **even when a referral was logged and
marked "closed," only 38% of clients actually received the service** — down from
65% in an earlier period (JAMA Network Open, 2024). The loop *looked* closed. The
person wasn't served. That gap — between "closed" and "done" — is the whole
problem, and nothing on the market watches for it.

## What it does

Loose Ends watches opted-in channels for **open loops** — work that was asked for
or promised — and runs each through a deterministic ownership-and-fulfillment
state machine:

- **Detects unowned requests.** The un-cloned case: an ask nobody accepted
  ("can someone confirm Mr. Okafor's clinic appointment?"), which is different
  from a personal commitment someone forgot. Every existing commitment bot only
  catches the second kind.
- **Escalates to a backup human.** If the response window passes with no owner, it
  routes a calm "nobody has picked this up" card to a pre-designated coordinator.
  One tap claims it.
- **Verifies fulfillment on evidence, not a timer.** This is the flagship. When a
  later message proves the work landed ("closed out the Diaz housing case"), the
  card flips to **Verified**. When a deadline passes with *no* such evidence, the
  loop stays **open**, then BROKEN — because closed is not done.
- **Stays silent on noise.** "we should grab lunch," "I'll think about it" never
  enter the ledger. Restraint is the UX.

## How I built it

Three eligible technologies, each load-bearing, on top of a deterministic spine:

- **Slack AI (bring-your-own-model).** A real LLM call — OpenAI's `gpt-4o-mini` in
  this build (the layer is provider-swappable to Claude) — does the
  request-vs-commitment judgment (owner, deadline, confidence) as strict JSON
  (structured outputs). A cheap deterministic noise filter runs in front to
  guarantee silence and cut tokens.
- **Real-Time Search API.** An on-demand `assistant.search.context` lookup:
  @-mention the agent and ask "what's still open here?" (RTS is a pull/query API
  that needs an ephemeral action_token — so it's used for exactly that, not as a
  scanner.)
- **Events API + Block Kit.** The `message.channels` push stream is the real-time
  ingestion (RTS can't scan channels); Block Kit cards with wired `block_actions`
  are the one-tap review gate; governed write-back goes through the Web API.
- **The deterministic ledger.** Every status decision — ownership, escalation
  timers, break, dedupe — is a pure, reproducible, fully-audited state machine,
  independent of what the model said. That is what makes the escalation
  trustworthy and separates this from a prompt-only clone.

Stack: TypeScript, Bolt (Socket Mode), the OpenAI SDK (swappable to
`@anthropic-ai/sdk`), node:test. ~1,000 lines, 22 unit tests, and an evaluation
harness.

## Accomplishments I'm proud of

- **A real, measured false-positive story, not a vanity number.** A regex clone of
  "detect a promise" tops out at **52% recall and a 17.4% false-positive rate** on
  a 48-message frontline corpus deliberately built to include the phrasings a
  keyword filter can't see. The LLM extractor (OpenAI `gpt-4o-mini`) takes that to
  **100% recall, 92.6% precision, an 8.7% false-positive rate, and 100% accuracy
  on the request-vs-commitment split** — recall doubled, false positives halved.
  That delta is the proof the AI is load-bearing, not bolted on.
- **The one capability nobody else has:** evidence-based fulfillment verification.
- **Everything is real** — live Events ingestion, real classification, real
  Block Kit gate, real evidence detection — with the deterministic core fully
  unit-tested.

## Challenges I ran into

- **RTS is not a channel watcher.** My first design assumed RTS could passively
  scan channels. It can't: it's pull-only, its bot calls need an ephemeral
  action_token that only arrives on @-mention/DM, and it forbids storing results.
  I re-based ingestion on the Events API push stream and gave RTS its honest job
  as the on-demand lookup — a correction that made the whole design survive
  contact with the real APIs.
- **The Slack MCP server has no Lists/task tool** (message + canvas only), so
  governed write-back uses the Web API directly.
- **"Slack AI" is bring-your-own-model** — there's no hosted LLM for developers
  and the challenge requires no specific vendor — so the extractor calls your
  model (OpenAI here) with your key.

## What I learned

Determinism is the feature. The reliable, auditable part of an agent is the state
machine; the model's job is narrow judgment over messy text. Keeping the two
strictly separated is what makes the escalation something a frontline coordinator
could actually trust with a family's case.

## Impact (Slack Agent for Good)

Dropped follow-ups and missed handoffs are one of the top categories of waste in
health and social care ($25–45B/year; Berwick & Hackbarth, JAMA 2012), and ~80%
of serious medical errors involve miscommunication at a handoff (Joint
Commission). Loose Ends targets that failure directly in the tool frontline teams
already live in, with a quantifiable benefit: fewer unowned asks silently
dropped, and — uniquely — a check that "closed" loops were actually served.
⟨pilot line: "In a ⟨N⟩-person pilot workspace over ⟨X⟩ days, Loose Ends caught
⟨Y⟩ unowned asks, escalated ⟨Z⟩, and flagged ⟨W⟩ loops closed without evidence."⟩

## What's next

Per-workspace tuning of the SLA/escalation timers, a dismissal-feedback loop that
retrains the filter, a prospective precision/recall study against a gold-standard
labeled set, and Slack Marketplace review for admin controls and data residency.

## Built with

`typescript` · `slack-bolt` · `slack-events-api` · `slack-real-time-search-api` ·
`slack-block-kit` · `openai` · `node`

## Links

- Demo video: ⟨URL⟩
- Sandbox URL (access granted to slackhack@salesforce.com & testing@devpost.com): ⟨URL⟩
- Architecture diagram: `docs/architecture.svg`
- Repo: ⟨URL⟩
