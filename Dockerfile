# -----------------------------------------------------------
# Primordia Bridge — Production Dockerfile (Optimized)
# -----------------------------------------------------------
FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# --- OPTIMIZATION START ---
# 1. Copy ONLY the package files first.
# This creates a separate Docker layer.
COPY package*.json ./

# 2. Install dependencies.
# This layer will be cached and only re-run if package.json or package-lock.json changes.
# This is the step that will save us minutes.
RUN npm ci --omit=dev

# 3. Copy the rest of the source code.
# Changing our source code will no longer cause npm to re-install everything.
COPY . .
# --- OPTIMIZATION END ---

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the service port for Cloud Run
EXPOSE 8080

# Add health check for Cloud Run container monitoring
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:${PORT}/healthz || exit 1

# Drop root privileges for security
RUN useradd -m primordia
USER primordia

# Start the service
CMD ["node", "index.js"]
