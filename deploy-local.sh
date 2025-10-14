#!/usr/bin/env bash
set -euo pipefail
echo "🔧 Building primordia image..."
docker build -t primordia:local .
echo "🚀 Starting local stack..."
docker compose up -d gcs pubsub firestore gcs-init primordia local-launcher
echo "📡 Waiting for primordia..."
sleep 3
echo "✅ Up. API http://localhost:8080  GCS http://localhost:4443  PubSub :8083  Firestore :8085"
docker compose logs -f --tail=200 primordia local-launcher
