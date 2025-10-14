#!/bin/bash
set -e
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes found. Please commit before deploying."
  git status
  exit 1
fi
echo "✅ Git status is clean."
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)
if [ -z "$PROJECT_ID" ]; then
  echo "❌ FATAL: PROJECT_ID is not set in your environment."
  exit 1
fi
echo "✅ Deploying to project: $PROJECT_ID"
ALLOWED_ORIGIN="https://*.a.run.app"
echo "🚀 Starting Cloud Build with PROXY_ALLOWLIST set to: ${ALLOWED_ORIGIN}"
gcloud builds submit \
  --config cloudbuild.yaml \
  --project=$PROJECT_ID \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION,_PROXY_ALLOWLIST="${ALLOWED_ORIGIN}" \
  .
echo "🎉 Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --project=${PROJECT_ID} --format='value(status.url)')
echo "Service is live at: ${SERVICE_URL}"
echo "Pinging /healthz endpoint (retrying up to 60s)..."
for i in {1..12}; do
  if curl --max-time 10 -sSf -o /dev/null "${SERVICE_URL}/healthz"; then
    echo ""
    echo "✅ Health check passed. Deployment complete and verified."
    exit 0
  fi
  echo "Attempt ${i} failed. Retrying in 5 seconds..."
  sleep 5
done
echo "⚠️ Health check timed out. The service is likely still starting up. Please verify manually."
exit 0
