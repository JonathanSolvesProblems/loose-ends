# Loose Ends

An org-level coverage-gap safety net for mission-driven Slack workspaces. Loose
Ends watches opted-in channels for **open loops** (work that was asked for or
promised), tracks each one through a deterministic ownership-and-fulfillment state
machine, and escalates to a human before a request silently falls through the
cracks. The un-cloned target is the **unowned request**: something asked that
nobody has claimed yet. Those are the ones that drop.

**Track:** Slack Agent for Good.

**Uniqueness claim (locked):** No existing tool combines ownership-gap detection
(requests nobody has claimed) + deterministic escalation to a backup human +
RTS-based fulfillment verification + governed MCP write-back, aimed at
social-impact Slack workspaces. Commitment Crawler and ClearFeed handle
first-person self-reminders or support-desk SLAs for enterprises. None of them
close the loop on unowned work in a mission-driven context.

## The problem

In a nonprofit, mutual-aid, or community-health Slack, an unanswered "can someone
follow up with the Diaz family?" is not a slipped deck. It is a person not served.
The message scrolls away, everyone assumes someone else has it, and nobody does.

> Quantified harm: _[CITATION SLOT: cost / outcome of a dropped client follow-up or
> missed service handoff in social services or community health. Aim for a
> per-event figure with a peer-reviewed or government source. Target 8 to 14
> references across the README.]_

## How this differs from what already exists

I checked the prior art. The core "detect a Slack promise and nudge" mechanic is
taken. Here is exactly where Loose Ends does something they do not:

| Capability | Commitment Crawler | ClearFeed | Sleuth / Follow Up Bot | **Loose Ends** |
| --- | --- | --- | --- | --- |
| First-person commitments | Yes | Yes | Yes | Yes |
| **Unowned requests (nobody claimed it)** | No | No | No | **Yes** |
| **Escalation to a backup human** | No | Support SLA only | No | **Yes** |
| **RTS fulfillment verification (loop actually closed)** | No (timed nudges) | No | No | **Yes** |
| **Governed MCP write-back to a system of record** | Calendar block only | Ticketing | No | **Yes** |
| **Social-impact / frontline focus** | No (enterprise) | No (support) | No | **Yes** |

Commitment Crawler already advertises a "<8% false-positive rate", so a measured
false-positive number is table stakes, not a moat. My moat is the combination
above plus a **frontline-scenario evaluation corpus** the enterprise tools have no
reason to build.

## How it maps to the judging criteria

| Criterion | How Loose Ends scores |
| --- | --- |
| **Technological Implementation** | RTS API for continuous passive monitoring AND fulfillment detection, an MCP write-back server, and Slack AI extraction. Three technologies, one coherent architecture. |
| **Design** | Never spams a channel. Ephemeral owner nudges, coordinator "claim it" cards, a per-team Loose Ends Canvas/List, one-tap Claim / Done / Snooze / Dismiss. Restraint is the UX. |
| **Potential Impact** | Targets dropped work in social-impact workspaces, where the downstream harm is a person, not a deliverable, and is quantifiable. |
| **Quality of the Idea** | Reframes the saturated "commitment bot" into the un-served ownership-gap problem, with the prior-art homework shown above. |

## Architecture

```
Slack workspace ──RTS API──> [Watcher]  continuous, scoped to opted-in channels
                                 │ candidate messages
                                 ▼
                    [Extractor]  Slack AI / Claude  →  (request|commitment, owner?, deadline?, confidence)
                                 │  (deterministic pre-filter in front to cut tokens + false positives)
                                 ▼
                    [Ledger]  DETERMINISTIC state machine + SLA timers + escalation + dedupe
                                 │  unowned / due / escalated / broken
                                 ▼
                    [Review gate]  Block Kit: Claim / Done / Snooze / Dismiss
                                 │  approved actions only
                                 ▼
                    [Action MCP server]  → Slack List item / reminder / Task  (system of record)
                  RTS also feeds fulfillment detection back into the ledger (loop closed).
```

- **RTS API** = the eyes. Surfaces candidates and detects fulfillment.
- **Slack AI / Claude** = the judgment. Classifies request vs commitment, owner, deadline.
- **Deterministic ledger** = the spine. Ownership, SLA timers, escalation, dedupe, audit log.
- **MCP server** = the hands. Governed, idempotent write-back behind a human gate.

### The state machine

```
UNOWNED   ──claimed──────────────> CLAIMED
UNOWNED   ──response SLA passes──> ESCALATED   (ping a coordinator)
CLAIMED   ──deadline passes──────> DUE
DUE       ──grace passes─────────> ESCALATED
ESCALATED ──escalation grace─────> BROKEN
any       ──fulfillment / done──> FULFILLED
any       ──snooze──────────────> SNOOZED ──ends──> UNOWNED | CLAIMED
any       ──reviewer dismiss────> DISMISSED
```

### Deterministic vs generative split

The generative layer only classifies and extracts. Every status decision
(ownership, escalation, fulfillment, break) is deterministic, reproducible, and
logged. That is what makes the behavior auditable and the escalation trustworthy.

## Repo layout

```
src/types.ts      domain types (platform-agnostic)
src/ledger.ts     deterministic open-loop state machine + escalation  <- the moat
src/extractor.ts  pre-filter + Slack AI / LLM extraction (request vs commitment)
src/watcher.ts    RTS API adapter: candidates + fulfillment detection (eyes)
src/actions.ts    Block Kit review gate + MCP write-back (hands)
src/index.ts      the agent loop + an offline demo
eval/corpus.jsonl labeled open loops vs noise, frontline scenarios
eval/evaluate.ts  precision / recall / false-positive rate / kind accuracy harness
```

## Run it (no workspace required)

```bash
node --experimental-strip-types src/index.ts    # the agent loop on mock data
node --experimental-strip-types eval/evaluate.ts # the demo numbers
```

The demo ingests four messages. An unowned "follow up with the Diaz family"
request escalates when nobody claims it, then a coordinator claims it (the rescue).
A grant-report commitment goes BROKEN after its deadline, grace, and escalation
all pass with no action. "we should grab lunch sometime" and "I'll think about it"
never enter the ledger. That silence is the negative control.

## 42-day build plan (2026-06-01 -> 2026-07-13)

- **Week 1:** Sandbox + `slack create agent`. RTS returning messages. Ledger + escalation. (done here)
- **Week 2:** Real LLM extractor (request vs commitment) + tune the pre-filter. Log detections, fire nothing.
- **Week 3:** Grow the frontline eval corpus, lock false-positive + kind-accuracy numbers. Protect this time.
- **Week 4:** MCP write-back + Block Kit Claim/Done/Snooze/Dismiss cards + per-team Canvas/List.
- **Week 5:** RTS fulfillment detection, coordinator routing, the For Good demo scenario in a realistic nonprofit-style workspace.
- **Week 6:** Freeze Jul 8. Record demo, finish README citations + diagram, grant sandbox access to slackhack@salesforce.com and testing@devpost.com, submit early.

## ~3-minute demo script

1. The pain: a frontline channel where "can someone follow up with the Diaz family?" scrolls away unowned.
2. Loose Ends tracks it as UNOWNED and, when nobody claims it, escalates a calm "nobody has picked this up" card to a coordinator. One tap claims it. The family does not get dropped.
3. Second loop: a grant-report commitment with a Friday deadline. Friday passes, no fulfillment detected via RTS, it escalates, still nothing, it goes BROKEN, on the dashboard for the team to see.
4. **Negative control:** show "we should do lunch" and "I'll think about it". The agent stays silent. Put the false-positive rate on screen.
5. Close on the impact number from the references.

## Honest limitations and path to production

- Privacy: opted-in channels only, no message storage beyond the ledger, no-content logging (RTS keeps data inside Slack).
- Extraction will not catch every phrasing; recall is bounded by the pre-filter.
- "Unowned" is inferred; a real deployment needs a feedback loop so dismissals retrain it.
- Needs a prospective precision/recall study against a gold-standard labeled set.
- Production needs Slack Marketplace review, admin controls, and data-residency handling.

## References

_[CITATION SLOTS: 8 to 14 references. Suggested coverage: cost / outcome of dropped
client follow-ups in social services and community health, service-coordination
failures, nonprofit capacity and volunteer-coordination research, Slack platform
docs for RTS API and MCP, accountability / SLA research.]_
