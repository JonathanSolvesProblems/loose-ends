# Loose Ends: Devpost submission copy

> Read this out loud before you paste it. Change any sentence that does not sound
> like you. Judges read hundreds of these and can tell when a person wrote it.
> The only field I cannot write for you is the first line of **Inspiration**.
> Fill the `⟨…⟩` slots, delete this box, then paste.

**Track:** Slack Agent for Good
**Name:** Loose Ends

---

## Elevator pitch (one line)

Loose Ends catches asks in Slack that nobody accepted, and refuses to mark them
done until it finds evidence the work actually happened.

---

## Inspiration

⟨One or two sentences, in your own words, about the specific moment or person that
made you build this. If there isn't one, say plainly why the problem bothers you.
Do not invent a story.⟩

The number that convinced me this was worth building: in a study of 115,316
social-services referrals across 26 counties, even when a referral was logged and
marked "closed," only 38% of clients actually received the service. That is down
from 65% in an earlier period (JAMA Network Open, 2024).

The loop looked closed. The person was never served.

Every commitment bot I found treats a passing deadline, or a clicked button, as
proof that work happened. None of them check. In a nonprofit or a mutual-aid
Slack, that gap is not a slipped deck. It is a family that never got a callback.

## What it does

Loose Ends watches the channels you invite it to and tracks "open loops," which
is work that was either asked for or promised.

It does three things nothing else does together:

1. **It finds unowned requests.** "Can someone follow up with the Diaz family?" is
   an ask nobody accepted. That is a different failure from a personal promise
   someone forgot, and it is the one that drops silently. Every commitment bot I
   looked at only catches the second kind.
2. **It escalates to a real person.** If nobody claims an ask inside the response
   window, it routes a calm card to a designated backup coordinator. One tap
   claims it.
3. **It only closes a loop on evidence.** When someone later posts "closed out the
   Diaz housing case," Loose Ends finds that message and marks the loop verified.
   When a deadline passes with no such message, the loop stays open, then breaks.
   Closed is not done.

It also stays quiet. "We should grab lunch" and "I'll think about it" never enter
the ledger. That silence is the point.

## How I built it

The design changed once I read the docs properly.

- **Ingestion is the Events API**, not the Real-Time Search API. RTS is a
  pull-only query API whose bot calls need an ephemeral `action_token`, so it
  cannot passively watch a channel. `message.channels` can, and it is not
  throttled.
- **The judgment is an AI call.** Every candidate message goes to `gpt-4o-mini`
  with a strict JSON schema, which returns request vs commitment, the owner, the
  deadline, and a confidence. A cheap deterministic filter runs in front so
  obvious chatter never costs a token and the agent is guaranteed to stay silent.
- **The spine is a deterministic state machine.** Ownership, SLA timers,
  escalation, dedupe, and the full audit trail are pure functions. Nothing about
  a loop's status depends on what the model felt like saying. That is what makes
  an escalation something a coordinator can trust.
- **The Real-Time Search API does the thing only it can do.** Mention the agent
  and say "scan this channel" and it searches the channel's past for asks that
  were dropped before it was ever installed. `conversations.history` is throttled
  to one request per minute for non-Marketplace apps, so there is no other way to
  do this. Slack's RTS terms say you must not store retrieved data, so the scan is
  strictly a read-only briefing: it classifies in memory, reports with permalinks,
  and writes nothing to the ledger.
- **The surface is Block Kit.** Interactive Claim / Mark done / Snooze / Dismiss
  cards, an eyes reaction while the model thinks, a check reaction on the message
  that served as proof, deadlines rendered in each viewer's own timezone, and
  mentions that actually notify the person who has to act.

Stack: TypeScript, Bolt on Socket Mode, the OpenAI SDK, `node:test`.

## Challenges I ran into

**RTS is not what I assumed.** My first architecture had RTS passively watching
channels. It cannot: it is pull-only, its bot calls need a token that only arrives
on a mention or DM, and it forbids storing results. I rebuilt ingestion on the
Events API and gave RTS the job it is actually good at.

**I then built an RTS feature that broke Slack's terms.** My channel scan seeded
the ledger from search results. Slack's docs say plainly, "You must not store or
copy any of the data retrieved from this API." I tore that out and made the scan a
transient, read-only briefing. It is a better feature for it, and it is honest.

**The ledger contradicted my own thesis.** An unclaimed request with a deadline
next week was being marked "dropped" after the escalation window, before the
deadline had even arrived. My entire pitch is that broken means "the deadline
passed with no evidence." I fixed the state machine and wrote a regression test
named after the bug.

**Deadlines were being resolved in the server's timezone.** Someone writing "by
2am" meant 2am where they were sitting. The agent now reads each author's Slack
timezone and grounds the deadline in their day.

## Accomplishments I'm proud of

I have a measured number instead of a vanity one.

I built a 48-message corpus of real frontline phrasing, including implied asks a
keyword filter cannot see ("the Diaz family still hasn't heard back") and traps it
false-fires on ("I'll be out Friday"). On that corpus:

| Extractor | Precision | Recall | False positives |
| --- | --- | --- | --- |
| Regex clone | 76.5% | 52.0% | 17.4% |
| AI extractor (`gpt-4o-mini`) | **92.6%** | **100%** | **8.7%** |

The AI doubles recall and halves false positives. That is the argument for it
being load-bearing rather than decorative. A weekend keyword bot tops out at the
first row.

Then I measured the part that actually matters. Finding a dropped ask is table
stakes. The thing nobody else does is refusing to close it without proof, so the
verifier got its own corpus, and I treated its two errors as very different. A
false verify means marking work done that never happened, which is the exact harm
this project exists to prevent. A missed proof just leaves the loop open for a
human, which is safe.

| Verifier | Precision on "done" | Recall of real proof | False-verify rate |
| --- | --- | --- | --- |
| Keyword bot | 63.6% | 53.8% | 23.5% |
| Loose Ends | **100%** | **92.3%** | **0.0%** |

A keyword bot closes the Diaz case when somebody writes "closed out the Ramirez
case." Loose Ends made zero false verifies across 17 negatives.

31 unit tests, a clean type-check, live-tested in a sandbox, and deployed as a
portless Docker worker.

## What I learned

Determinism is the feature. The trustworthy part of an agent is the state machine.
The model's job is narrow judgment over messy text. Keeping those two strictly
separated is what lets a frontline coordinator trust an escalation with a family's
case.

I also learned to read the platform's terms before designing around a capability,
not after.

## Impact

Dropped handoffs and follow-ups are one of the largest categories of waste in
health and social care: $25 to $45 billion a year (Berwick and Hackbarth, JAMA
2012), and roughly 80% of serious medical errors involve miscommunication at a
handoff (Joint Commission).

Loose Ends attacks that inside the tool frontline teams already live in, and it
targets the specific failure nobody else does: a loop that looks closed but was
never actually served. For a small nonprofit with no operations layer, the cost of
a dropped ask is not a missed deliverable. It is a person.

⟨If you run the pilot: "In a ⟨N⟩-person workspace over ⟨X⟩ days, Loose Ends caught
⟨Y⟩ unowned asks, escalated ⟨Z⟩, and flagged ⟨W⟩ loops that hit their deadline with
no evidence of completion."⟩

## What's next

Per-workspace tuning of the escalation windows, a feedback loop so dismissals
retrain the filter, a durable store so the ledger survives a restart, and a
prospective accuracy study against a labeled gold standard.

## Built with

`typescript` `slack-bolt` `slack-events-api` `slack-real-time-search-api`
`slack-block-kit` `openai` `node`

## Links

- Demo video: ⟨public YouTube URL⟩
- Slack sandbox (Member access granted to slackhack@salesforce.com and testing@devpost.com): ⟨URL⟩
- Code: https://github.com/JonathanSolvesProblems/loose-ends
- Architecture diagram: uploaded to the submission form's file field
