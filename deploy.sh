#!/bin/bash
set -e

# --- START: NEW LOGIC FOR CACHE FLAG ---
# Default to disabling the cache
USE_CACHE_FLAG="false"

# Check if the first argument is --use-cache to enable it
if [[ "$1" == "--use-cache" ]]; then
  USE_CACHE_FLAG="true"
  echo "🟢 Cache explicitly enabled for this deployment."
fi
# --- END: NEW LOGIC ---

if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes found. Please commit before deploying."
  git status
  exit 1
fi
echo "✅ Git status is clean."
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting the Cloud Build deployment..."

# Updated gcloud command to pass the cache flag
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION,_USE_FIRESTORE=true,_USE_CACHE=$USE_CACHE_FLAG \
  .

echo "🎉 Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --format='value(status.url)')
echo "Service is live at: ${SERVICE_URL}"
echo "Pinging /healthz endpoint (retrying up to 50s)..."
for i in {1..10}; do
  if curl -sSf -o /dev/null "${SERVICE_URL}/healthz"; then
    echo ""
    echo "✅ Health check passed. Deployment complete and verified."
    exit 0
  fi
  echo "Attempt ${i} failed. Retrying in 5 seconds..."
  sleep 5
done

echo "❌ Health check failed after 10 attempts."
exit 1
