#!/bin/bash
# -----------------------------------------------------------------------------
# This is the definitive script to deploy the Primordia service.
# It handles permissions, checks for uncommitted changes, and deploys.
# Run it from the ~/primordia directory with: ./deploy.sh
# -----------------------------------------------------------------------------

# Exit immediately if a command exits with a non-zero status.
set -e

# --- GIT SANITY CHECK ---
# This is a guardrail. It prevents deploying if there are uncommitted changes.
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes found."
  echo "Please commit your changes before deploying."
  git status
  exit 1
fi
echo "✅ Git status is clean. Proceeding with deployment."


echo "✅ Step 1: Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

# --- DEFINE SERVICE ACCOUNTS ---
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUDBILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
PRIMORDIA_SA="primordia-sa@${PROJECT_ID}.iam.gserviceaccount.com"

echo "✅ Step 2: Granting permissions to the Cloud Build service..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUDBILD_SA}" \
  --role="roles/run.admin" --condition=None > /dev/null 2>&1 || echo "run.admin role already exists for Cloud Build."
gcloud iam service-accounts add-iam-policy-binding ${PRIMORDIA_SA} \
    --member="serviceAccount:${CLOUDBILD_SA}" \
    --role="roles/iam.serviceAccountUser" > /dev/null 2>&1 || echo "iam.serviceAccountUser role already exists for Cloud Build."

echo "✅ Step 3: Granting permissions to the Primordia application..."
# ... (rest of the permissions are the same) ...
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/datastore.user" --condition=None > /dev/null 2>&1 || echo "datastore.user role already exists for Primordia."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/storage.admin" --condition=None > /dev/null 2>&1 || echo "storage.admin role already exists for Primordia."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/cloudbuild.builds.editor" --condition=None > /dev/null 2>&1 || echo "cloudbuild.builds.editor role already exists for Primordia."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/logging.viewer" --condition=None > /dev/null 2>&1 || echo "logging.viewer role already exists for Primordia."

echo "🚀 Step 4: Starting the Cloud Build deployment..."
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION \
  .

echo "🎉 Step 5: Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --format='value(status.url)')
echo "Service is live at: ${SERVICE_URL}"
echo "Pinging /healthz endpoint (will retry for up to 50 seconds)..."

for i in {1..10}; do
  if curl -sSf -o /dev/null "${SERVICE_URL}/healthz"; then
    echo ""
    echo "✅ Health check passed on attempt ${i}."
    echo "✅ Deployment complete and verified."
    exit 0
  fi
  echo "Attempt ${i} failed. Retrying in 5 seconds..."
  sleep 5
done

echo "❌ Health check failed after 10 attempts."
exit 1
