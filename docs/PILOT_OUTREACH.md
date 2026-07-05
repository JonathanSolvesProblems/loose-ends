# Seeding a real pilot (why + ready-to-send messages)

Adoption beats architecture in judging. One line like "caught 14 unowned asks and
escalated 5 over 4 days across a 9-person mutual-aid team" outscores any diagram.
The goal here is 3–10 real people in a mission-driven Slack actually using Loose
Ends during the window, so you can quote a concrete number in the "Impact" and
"Accomplishments" sections.

## The lightest possible pilot

1. Spin up a free Slack workspace (or use an existing one you're in), add a
   channel like `#coordination`, and `/invite @loose-ends`.
2. Invite 3–10 real frontline people (a mutual-aid crew, a small nonprofit team, a
   community-health group, a volunteer coordinator you know).
3. Run the agent for 3–5 days in **normal** mode (not demo) against that channel.
4. Screenshot: an unowned ask being escalated, a card flipping to Verified, and
   the running tally.

### What to measure (the quotable line)

- unowned asks caught · escalated to a backup · claimed · **loops that hit their
  deadline with no evidence of completion** (the "closed ≠ done" catch)
- false positives (should be near zero — that's the restraint story)

---

## 1. Warm DM (someone you know at a nonprofit / mutual-aid org)

> Hey [name] — I built a small Slack agent for exactly the thing your team
> deals with: asks that scroll past in a busy channel and nobody picks up, so a
> follow-up quietly drops. It flags an ask nobody accepted, nudges the channel,
> and if it still sits there, escalates it to a backup person. And it only marks
> something done once it sees proof in the thread that the work actually
> happened, not just because a due date passed.
>
> Could I add it to one channel on your Slack for a few days this week? Zero setup
> on your end, it stays quiet on normal chatter, and you'd genuinely get value
> from it. I'd love your honest read.

## 2. Short email (a program or ops lead)

> Subject: a 5-minute favor — catching dropped follow-ups in your Slack
>
> Hi [name],
>
> I built a Slack agent called Loose Ends for mission-driven teams. It watches a
> channel for work that was asked for or promised, and catches the ones that fall
> through the cracks: an ask nobody claimed gets escalated to a backup person
> before it's lost, and a task only counts as done when there's evidence in the
> thread that it actually happened.
>
> The reason it matters: even when a social-services referral is marked "closed,"
> studies find only ~38% of clients actually received the service. This is the
> check for that gap.
>
> Would you let me run it in one channel for 3–5 days? It's silent on small talk,
> needs nothing from your team, and I'll share exactly what it caught.
>
> Thanks,
> [you]

## 3. Community post (nonprofit-tech / mutual-aid Slack or Discord)

> I made a free Slack agent for frontline teams: it catches asks in a channel that
> nobody accepted and escalates them to a backup person before they drop, and it
> verifies work got done from the actual conversation instead of trusting a
> deadline. Built it for the Slack "Agent for Good" hackathon. Looking for 3–5
> small teams to try it in one channel this week and tell me if it's useful — DM
> me and I'll get you set up in a few minutes.

## 4. Hackathon channel (#slack-agent-builder-challenge)

> Building "Loose Ends" (Agent for Good) — it catches unowned asks in a channel
> and only marks them done on evidence the work landed, not a timer. If anyone
> runs a small mission-driven Slack (nonprofit, mutual-aid, community health) and
> would pilot it in one channel for a few days, I'd love the real-world feedback —
> reply or DM.

---

## Notes

- Keep it to **one channel** for the pilot — lower friction, cleaner numbers.
- Run in normal mode for real timing; use `LOOSE_ENDS_DEMO=1` only for the video.
- If someone's nervous about privacy, the honest answer: it watches only the
  channel you invite it to, stores derived loop state (not a message archive), and
  every write is behind a human tap.
