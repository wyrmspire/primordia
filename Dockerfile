# -----------------------------------------------------------
# Primordia Bridge (API + Worker) — Production Dockerfile
# -----------------------------------------------------------
FROM node:20-slim AS base

# THE FIX: Add 'procps' which provides the 'ps' command needed by pm2.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl procps && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Install pm2 globally within the container
RUN npm install pm2 -g

# This line has been removed:
# COPY service-account-key.json ./

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Health check now targets the API service specifically
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:${PORT}/healthz || exit 1

RUN useradd -m primordia
USER primordia

# Start both services using the ecosystem file.
# --no-daemon keeps pm2 in the foreground, which is required for Cloud Run.
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
