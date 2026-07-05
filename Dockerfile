# Loose Ends runs over Slack Socket Mode, so it needs NO inbound port or public
# URL — it's a background worker that connects out to Slack. Deploy it anywhere
# that can keep a Node process running (Railway, Render background worker, Fly,
# a small VM). Set the env vars from .env.example on the host; do NOT bake secrets
# into the image.

FROM node:24-slim
WORKDIR /app

# Install only runtime deps (we run TypeScript directly via --experimental-strip-types,
# so no build/emit step is needed).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# npm start = node --experimental-strip-types --env-file-if-exists=.env src/slack/app.ts
# (.env is absent in the image, so config falls back to the platform's env vars.)
CMD ["npm", "start"]
