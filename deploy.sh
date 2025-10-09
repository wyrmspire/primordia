#!/bin/bash
# -----------------------------------------------------------------------------
# This is the definitive script to deploy the Primordia service.
# It handles permissions and deployment in the correct order.
# Run it from the ~/primordia directory with: ./deploy.sh
# -----------------------------------------------------------------------------

# Exit immediately if a command exits with a non-zero status.
set -e

echo "✅ Step 1: Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

# --- DEFINE SERVICE ACCOUNTS ---
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
PRIMORDIA_SA="primordia-sa@${PROJECT_ID}.iam.gserviceaccount.com"

echo "✅ Step 2: Granting permissions to the Cloud Build service..."
# Grant Cloud Build permission to deploy to Cloud Run and manage our new SA
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin" --condition=None > /dev/null 2>&1 || echo "run.admin role already exists for Cloud Build."
gcloud iam service-accounts add-iam-policy-binding ${PRIMORDIA_SA} \
    --member="serviceAccount:${CLOUDBUILD_SA}" \
    --role="roles/iam.serviceAccountUser" > /dev/null 2>&1 || echo "iam.serviceAccountUser role already exists for Cloud Build."

echo "✅ Step 3: Granting permissions to the Primordia application..."
# Grant Primordia permission to use Storage, Firestore, and trigger other builds
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/datastore.user" --condition=None > /dev/null 2>&1 || echo "datastore.user role already exists for Primordia."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/storage.admin" --condition=None > /dev/null 2>&1 || echo "storage.admin role already exists for Primordia."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/cloudbuild.builds.editor" --condition=None > /dev/null 2>&1 || echo "cloudbuild.builds.editor role already exists for Primordia."

echo "🚀 Step 4: Starting the Cloud Build deployment..."
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_PROJECT_ID=$PROJECT_ID,_REGION=$REGION,_WORKSPACE_BUCKET=$WORKSPACE_BUCKET,_CACHE_COLLECTION=$CACHE_COLLECTION,_TASKS_COLLECTION=$TASKS_COLLECTION \
  .

echo "🎉 Step 5: Verifying the live service..."
SERVICE_URL=$(gcloud run services describe primordia --region ${REGION} --format='value(status.url)')
echo "Service is live at: ${SERVICE_URL}"
echo "Pinging /healthz endpoint..."
# Add a small sleep to give the service a moment to stabilize
sleep 5
curl --fail "${SERVICE_URL}/healthz"

echo ""
echo "✅ Deployment complete and verified."
