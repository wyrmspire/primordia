#!/bin/bash
set -e

# --- Logic for cache flag ---
USE_CACHE_FLAG="false"
if [[ "$1" == "--use-cache" ]]; then
  USE_CACHE_FLAG="true"
  echo "🟢 Cache explicitly enabled for this deployment."
fi

# --- Git safety check ---
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes found. Please commit before deploying."
  git status
  exit 1
fi
echo "✅ Git status is clean."
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

# --- START: NEW ENVIRONMENT VALIDATION ---
# This new block checks if the PROJECT_ID was loaded successfully.
if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "❌ FATAL: PROJECT_ID is not set in your environment."
  echo "   Please ensure your '.env' file contains a line like: PROJECT_ID=your-gcp-project-id"
  exit 1
fi
echo "✅ Deploying to project: $PROJECT_ID"
# --- END: NEW VALIDATION ---

echo "🚀 Starting the Cloud Build deployment..."
gcloud builds submit \
  --config cloudbuild.yaml \
  --project=$PROJECT_ID \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION,_USE_FIRESTORE=true,_USE_CACHE=$USE_CACHE_FLAG \
  .

echo "🎉 Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --project=${PROJECT_ID} --format='value(status.url)')
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
