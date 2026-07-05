# Deploying Loose Ends (optional)

## Do you need this?

For the **Slack Agent for Good** track: **no, hosting is not required.** The
submission asks for a demo video, an architecture diagram, and your **Slack
developer sandbox URL** — not a deployment URL. Judges evaluate mainly from the
video.

The one reason to deploy: so the bot is **live in your sandbox whenever a judge
opens it**, instead of only while your laptop is running the process. If you're
fine running `npm start` locally during the judging window, skip this entirely.

(Hosting a public server *is* required for the **Organizations** track — Marketplace
deployment — but we deliberately targeted For Good, which doesn't need it.)

## Why deployment is trivial here

Loose Ends uses **Socket Mode**: the agent opens an *outbound* WebSocket to Slack.
There is **no inbound HTTP endpoint, no public URL, and no port to expose**. So you
deploy it as a **background worker / long-running process**, not a web service. No
domain, no TLS, no health-check port.

## What to set on the host

The same values as `.env.example`, as platform environment variables:

```
OPENAI_API_KEY          (or ANTHROPIC_API_KEY)
LOOSE_ENDS_MODEL        (optional; defaults gpt-4o-mini / claude-haiku-4-5)
SLACK_BOT_TOKEN
SLACK_APP_TOKEN
SLACK_SIGNING_SECRET
LOOSE_ENDS_COORDINATOR
LOOSE_ENDS_CHANNELS     (optional)
LOOSE_ENDS_TZ_OFFSET    (optional)
```

Do **not** set `LOOSE_ENDS_DEMO=1` in the hosted instance — that's only for the
video. Run production timers so escalations fire on real SLAs.

## Options (easiest first)

### Railway
1. `railway init` in the repo (or connect the GitHub repo in the dashboard).
2. Add the env vars above under *Variables*.
3. Railway detects the `Dockerfile` and runs `npm start`. Done — no port config,
   it just stays connected.

### Render (Background Worker)
1. New → **Background Worker** (not Web Service — there's no port).
2. Point it at the repo; it uses the `Dockerfile`. Or set:
   - Build: `npm ci --omit=dev`
   - Start: `npm start`
3. Add the env vars. Deploy.

### Fly.io
1. `fly launch` (it detects the `Dockerfile`). When asked about a public service /
   ports, say **no** — Socket Mode needs none.
2. `fly secrets set OPENAI_API_KEY=... SLACK_BOT_TOKEN=... SLACK_APP_TOKEN=... SLACK_SIGNING_SECRET=... LOOSE_ENDS_COORDINATOR=...`
3. `fly deploy`.

### A small VM (systemd)
`npm ci --omit=dev` then run `npm start` under a process manager (systemd,
`pm2`, or `tmux`) with the env vars exported.

## Verify it's live

- The process logs `⚡ Loose Ends is live (...)` on start.
- Post a test ask in a channel the bot is invited to; the claim card should appear.
- `/looseends` in that channel returns the open-loop list.

## Cost

Idle most of the time; a hobby/free tier on any of the above is plenty for a
demo/judging window. LLM calls are a few hundred tokens per message.
