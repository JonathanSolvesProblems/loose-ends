# Deploying Loose Ends

## Why this is now required

Judges test submissions asynchronously over a multi-week window. Loose Ends runs
over Slack Socket Mode, which means the agent process must be alive for the bot to
respond. If it only runs on your laptop, a judge opening your sandbox at 2am finds
a dead bot. That is a silent way to lose.

The Devpost form does not ask for a deployment URL. Deploy anyway, so the sandbox
you hand the judges is actually live.

## Why deployment is simple here

Socket Mode opens an **outbound** WebSocket to Slack. There is no inbound HTTP, so:

- no public URL
- no port to expose
- no domain, no TLS, no health check

You are deploying a **background worker**, not a web service. Any platform that can
keep a Node process running will do.

## Two rules that will bite you

1. **Run exactly one instance.** Two instances each open their own Socket Mode
   connection. Slack load-balances events across connections, so a Claim can land
   in one process's in-memory ledger while the "closed out" message lands in the
   other's, and verification silently never fires. This happened during
   development. `render.yaml` pins `numInstances: 1`.
2. **Kill your local agent once the deployed one is live.** Same reason. Running
   `npm start` locally while the deploy is up recreates the split brain.

Also note: the ledger is in memory, so a redeploy or restart forgets loops that
are currently open. That is acceptable for judging and is listed as a known
limitation in the README.

## Current deployment: OVH sandbox (live)

Loose Ends runs on the OVH sandbox box, `51.161.82.166`, SSH as `jonathan`.

```
~/experimental-projects/loose-ends/
├── app/                  git clone of the public repo
├── docker-compose.yml    portless worker, 1 replica, log rotation
└── .env                  secrets, chmod 600, no LOOSE_ENDS_DEMO
```

It is deliberately entangled with nothing else on that shared box. It declares no
ports, no volumes, no Traefik labels, and no shared network, so it sits alone on
its own `loose-ends_default` bridge. This mirrors the `~/discord-idea-bot` stack.

**Update to the latest commit:**

```bash
ssh jonathan@51.161.82.166
cd ~/experimental-projects/loose-ends
git -C app pull
docker compose up -d --build
docker compose logs -f app          # expect: production timers
```

**Recording the demo video.** The demo needs the 15 second timers, which means
running locally with `LOOSE_ENDS_DEMO=1`. Two Socket Mode connections would split
your events across two ledgers, so stop the server first:

```bash
ssh jonathan@51.161.82.166 'cd ~/experimental-projects/loose-ends && docker compose stop'
# record locally with LOOSE_ENDS_DEMO=1 npm start
ssh jonathan@51.161.82.166 'cd ~/experimental-projects/loose-ends && docker compose start'
```

## Alternatives (the agent is portable)

Loose Ends is a plain Docker worker with no ports, no volumes, and no inbound
HTTP. Anything that keeps a container running will host it. The OVH box above is
what is actually live; the options below are equally valid and are here so the
project is not tied to one provider.

## Option A: Render, from the dashboard (no CLI)

The repo is public and ships a [`render.yaml`](../render.yaml) blueprint.

1. Sign in at <https://dashboard.render.com>.
2. **New** → **Blueprint** → connect `JonathanSolvesProblems/loose-ends`.
3. Render reads `render.yaml`, sees a Docker `worker`, and prompts for the secrets.
   Paste them from your local `.env`:

   | Variable | Where it came from |
   | --- | --- |
   | `OPENAI_API_KEY` | platform.openai.com/api-keys |
   | `SLACK_BOT_TOKEN` | app settings → OAuth & Permissions (`xoxb-…`) |
   | `SLACK_APP_TOKEN` | app settings → Basic Information → App-Level Tokens (`xapp-…`) |
   | `SLACK_SIGNING_SECRET` | app settings → Basic Information |
   | `LOOSE_ENDS_COORDINATOR` | your Slack member ID (`U…`) |

4. Deploy. Watch the logs for `⚡ Loose Ends is live (production timers)`.
5. Stop your local agent.

Background workers are a paid plan (a few dollars a month). For a submission that
must stay reachable for weeks, that is the cost of not losing on a technicality.

## Option B: Railway, from the dashboard

1. <https://railway.app> → **New Project** → **Deploy from GitHub repo**.
2. Pick `loose-ends`. Railway detects the `Dockerfile` automatically.
3. Add the same variables under **Variables**.
4. Confirm the service has **one** replica.

Railway gives trial credit, then runs a few dollars a month.

## Option C: Fly.io, if you prefer a CLI

```bash
fly launch --no-deploy          # say NO when asked to expose a public service
fly secrets set OPENAI_API_KEY=... SLACK_BOT_TOKEN=... SLACK_APP_TOKEN=... \
                SLACK_SIGNING_SECRET=... LOOSE_ENDS_COORDINATOR=...
fly deploy
fly scale count 1               # exactly one instance
```

## Never set this in production

```
LOOSE_ENDS_DEMO=1
```

That shrinks the escalation timers to roughly 15 seconds. It exists only so the
demo video can show an escalation and a break on camera. In production the
defaults are a 4 hour response window and 24 hour grace periods.

## Verify it is live

- Logs show `⚡ Loose Ends is live (production timers), model=openai:gpt-4o-mini`.
- Post an unowned ask in a channel the bot is in. A claim card should appear.
- `@loose-ends scan this channel` returns a Real-Time Search briefing.
