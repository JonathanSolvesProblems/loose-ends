# Loose Ends

A Slack agent that catches dropped commitments before they cause harm. It watches
opted-in channels, tracks each promise against a deterministic fulfillment state
machine, and surfaces a calm, human-gated nudge to the right person before the
promise is broken.

**Track:** Slack Agent for Good (also framed for New Slack Agent).

**Uniqueness claim (locked):** No other entry combines passive workspace-wide
commitment detection (Real-Time Search API) + a deterministic promise-fulfillment
state machine with a measured false-positive rate + governed, human-reviewed
write-back into Slack's system of record (Lists / reminders / Tasks via MCP).
Everyone else builds request/response bots. I built a continuous safety net.

## The problem

Commitments made in Slack ("I'll send the grant report by Friday", "I'll follow up
with the family tomorrow") scroll away and get dropped. In a workplace that is a
missed deliverable. In a nonprofit or frontline-services workspace it can be an
unanswered vulnerable person.

> Quantified harm: _[CITATION SLOT: cost of a dropped follow-up / missed handoff;
> aim for a per-event dollar or outcome figure with a peer-reviewed or industry
> source. Target 8 to 14 references across the README.]_

## Why it does not already exist

The saturated lane is meeting summarizers, standup bots, and helpdesk triage. All
reactive, all read-only. Loose Ends is proactive and closes the loop. The hard part
is knowing when **not** to fire, and that is exactly what a prompt-cloned weekend
build gets wrong.

## How it maps to the judging criteria

| Criterion | How Loose Ends scores |
| --- | --- |
| **Technological Implementation** | Uses the newest, least-cloned tech (RTS API) for continuous passive monitoring, plus an MCP write-back server and Slack AI extraction. Three technologies, one coherent architecture. |
| **Design** | Never spams a channel. Ephemeral nudges, a per-user Loose Ends Canvas/List, Block Kit cards with one-tap Done / Snooze / Not a commitment. Restraint is the UX. |
| **Potential Impact** | Dropped commitments are universal and quantifiable. The For Good framing targets nonprofit and frontline ops run in Slack. |
| **Quality of the Idea** | Reframes Slack from a chat log into an accountability surface. Instant recognition from anyone burned by a dropped promise. |

## Architecture

```
Slack workspace ──RTS API──> [Watcher]  continuous, scoped to opted-in channels
                                 │ candidate messages
                                 ▼
                    [Extractor]  Slack AI / Claude  →  (commitment? owner, deadline, confidence)
                                 │  (cheap deterministic pre-filter in front to cut tokens + false positives)
                                 ▼
                    [Ledger]  DETERMINISTIC state machine + SLA timers + dedupe
                                 │  due / at-risk / broken
                                 ▼
                    [Review gate]  Block Kit: Done / Snooze / Not a commitment
                                 │  approved actions only
                                 ▼
                    [Action MCP server]  → Slack List item / reminder / Task  (system of record)
```

- **RTS API** = the eyes. Surfaces candidates and detects fulfillment.
- **Slack AI / Claude** = the judgment. Extracts the structured commitment.
- **Deterministic ledger** = the spine. Reproducible timers, status, dedupe, audit log.
- **MCP server** = the hands. Governed, idempotent write-back behind a human gate.

### Deterministic vs generative split

The generative layer only extracts and classifies. Every status decision (OPEN ->
DUE -> BROKEN, fulfillment, snooze) is deterministic, reproducible, and logged. That
is what makes the behavior auditable and the false-positive rate stable.

## The moat

1. **Deterministic + generative architecture**, not a single LLM call.
2. **An evaluation corpus with a measured false-positive rate** (`eval/`). A clone
   has no number here.
3. **Governed write-back** behind a mandatory human-review gate.

## Repo layout

```
src/types.ts      domain types (platform-agnostic)
src/ledger.ts     deterministic commitment state machine  <- the moat
src/extractor.ts  pre-filter + Slack AI / LLM extraction
src/watcher.ts    RTS API adapter (eyes)
src/actions.ts    Block Kit review gate + MCP write-back (hands)
src/index.ts      the agent loop + an offline demo
eval/corpus.jsonl labeled commitments vs non-commitments
eval/evaluate.ts  precision / recall / false-positive rate harness
```

## Run it (no workspace required)

```bash
node --experimental-strip-types src/index.ts   # the agent loop on mock data
node --experimental-strip-types eval/evaluate.ts # the demo numbers
```

The demo ingests three messages. Only the real promise is tracked and goes BROKEN
after its deadline plus grace. "we should grab lunch sometime" and "I'll think about
it" never enter the ledger. That silence is the negative control.

## 42-day build plan (2026-06-01 -> 2026-07-13)

- **Week 1:** Sandbox + `slack create agent`. RTS returning messages. Ledger schema. (done: ledger + types here)
- **Week 2:** Real LLM extractor + tune the pre-filter. Log detections, fire nothing.
- **Week 3:** Grow the eval corpus, lock a false-positive number. Protect this time.
- **Week 4:** MCP write-back + Block Kit review gate + per-user Canvas/List.
- **Week 5:** Fulfillment detection via RTS, snooze/escalation, For Good demo scenario.
- **Week 6:** Freeze Jul 8. Record demo, finish README citations + diagram, grant
  sandbox access to slackhack@salesforce.com and testing@devpost.com, submit early.

## ~3-minute demo script

1. The pain: a real-looking thread where "I'll get the grant report to you by Friday" scrolls away.
2. Loose Ends quietly detects it and shows the ledger entry (owner + deadline + confidence).
3. Friday passes, no fulfillment, the owner gets a calm ephemeral nudge. One tap writes a Slack List item via MCP.
4. **Negative control:** show "we should do lunch" and "I'll think about it". The agent stays silent. Put the false-positive rate on screen.
5. For Good close: same agent in a mutual-aid workspace catches an unanswered request for help before it is dropped. End on the impact number.

## Honest limitations and path to production

- Privacy: opted-in channels only, no message storage beyond the ledger, no-content logging.
- Extraction will not catch every phrasing; recall is bounded by the pre-filter.
- Needs a prospective precision/recall study against a gold-standard labeled set.
- Production needs Slack Marketplace review, admin controls, and data-residency handling.

## References

_[CITATION SLOTS: 8 to 14 references. Suggested coverage: cost of dropped
handoffs/follow-ups, knowledge-worker context-switching cost, nonprofit/frontline
service-gap outcomes, Slack platform docs for RTS API and MCP, any accountability or
SLA research.]_
