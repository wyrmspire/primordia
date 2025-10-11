# -----------------------------------------------------------
# Primordia Bridge API — Production Dockerfile
# -----------------------------------------------------------
FROM node:20-slim AS base

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Copy ONLY the package files. This creates a cacheable layer.
COPY package*.json ./

# 2. Install production dependencies.
RUN npm ci --omit=dev

# 3. Copy the rest of the source code.
COPY . .

# --- IMPORTANT ---
# Set the final working directory to the API service
WORKDIR /app/src/api

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the service port for Cloud Run
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:${PORT}/healthz || exit 1

# Drop root privileges for security
RUN useradd -m primordia
USER primordia

# Start the API service specifically
CMD ["node", "--require", "dotenv/config", "index.js"]
