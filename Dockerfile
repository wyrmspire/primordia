# -----------------------------------------------------------
# Primordia Bridge — Production Dockerfile
# -----------------------------------------------------------
# ✅ Base: Secure, minimal Node.js 20 image
FROM node:20-slim AS base

# Ensure system certificates for HTTPS (required for GCP SDKs)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency files first for caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

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
