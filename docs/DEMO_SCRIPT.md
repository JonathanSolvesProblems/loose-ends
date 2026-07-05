# Loose Ends — 90-second demo script

Judges spend ~5–7 minutes per project and the first 60 seconds decide everything.
This script front-loads the one thing nobody else does — **verifying the work
actually landed** — and ends on the impact number. Target run time **90s**
(3:00 is the hard ceiling, not the goal).

Write and rehearse this BEFORE recording. If a beat doesn't earn its seconds, cut
it.

---

## Pre-flight (do this once, off-camera)

1. Run the agent in demo mode so timers fire in ~15s:
   `LOOSE_ENDS_DEMO=1 npm start`
2. One channel named `#intake` (a family-services nonprofit vibe). Bot invited.
   `LOOSE_ENDS_COORDINATOR` set to your "coordinator" account.
3. Two Slack identities on screen if you can (a poster + the coordinator who
   clicks Claim). Solo is fine — just switch accounts; the camera won't care.
4. Have these three messages ready to paste on cue:
   - A: `Can someone follow up with the Diaz family about their housing application?`
   - B: `closed out the Diaz housing case — they got the voucher`
   - C: `I'll get the grant report to the funder by Friday.`
   - Noise: `we should grab lunch sometime` · `I'll think about it, no rush`
5. Pre-stage a real-ish channel with a few benign messages scrolled above, so it
   looks like a live workspace, not a demo fixture.

---

## The script

**[0:00–0:10] — The drop.**
On screen: `#intake`. Type message **A**. Nobody replies.
> "This is the intake channel at a family-services nonprofit. Someone asks the
> team to follow up with the Diaz family. Nobody replies. That ask just went
> invisible — no owner, no deadline, no ticket."

**[0:10–0:22] — The catch.**
Loose Ends posts the claim card ("This needs an owner"). Point at it.
> "Loose Ends flagged it as an *unowned request* — an ask nobody accepted, which
> is different from a promise someone forgot — and asked the channel to claim it."

**[0:22–0:35] — Escalation to a human.**
Wait for the ~15s SLA. The card updates to "Nobody has picked this up" and pings
the coordinator. Coordinator clicks **Claim**. Card flips to "Claimed by @…".
> "Still nothing, so it escalates to the program's backup coordinator. She claims
> it in one tap. The Diaz family doesn't get dropped."

**[0:35–0:55] — The flagship: evidence, not a timer.**
Type message **B** ("closed out the Diaz housing case…"). The card flips to
**✅ Verified — closed on evidence**.
> "Two days later someone posts that the case was closed. Loose Ends *found that
> message* and closed the loop on evidence — not because a timer ran out. This is
> the part nothing else does."

**[0:55–1:12] — "Closed is not done."**
Type message **C** (the grant-report commitment). Let its deadline pass in demo
time with no completion message. It goes DUE → BROKEN, stays on the board.
> "Now the opposite. A commitment's deadline passes with no proof the work
> happened. Every commitment bot would mark this done. Loose Ends keeps it open,
> then flags it BROKEN — because closed is not done."

**[1:12–1:22] — Negative control.**
Type the two noise messages. Nothing happens.
> "And it stays silent on chatter — 'grab lunch,' 'I'll think about it.' It only
> speaks when a real loop is at risk."

**[1:22–1:30] — Close on the number.**
On-screen text: the eval numbers + the 38% stat.
> "In the field, even when a social-services referral is marked closed, only 38%
> of clients actually get the service. Loose Ends is the safety net that checks."

---

## On-screen captions (build-up text, one per beat)

- `An ask nobody accepted → drops silently`
- `Detected: UNOWNED request`
- `Escalated → Claimed by a human`
- `✅ Verified — on evidence, not a timer`
- `Deadline passed, no proof → stays OPEN → BROKEN`
- `Silent on noise (negative control)`
- `Regex clone: 52% recall, 17.4% false positives`
- `Loose Ends (AI): 100% recall, 8.7% false positives`
- `"Closed" referrals where the client was actually served: 38%`

## Recording notes

- Screen-record at 1080p+; keep the Slack window clean (hide unrelated channels).
- Cut the dead ~15s waits in the edit — say the voiceover line over them, then jump
  to the card update.
- No music over the voiceover on the flagship beat (0:35–0:55). Let it land.
- End card: project name + one-line pitch + the sandbox URL.
