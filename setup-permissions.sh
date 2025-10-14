#!/bin/bash
set -e
echo "🚀 Configuring GCP Permissions for Primordia..."
echo "---"
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ ERROR: No active GCP project. Run 'gcloud config set project YOUR_PROJECT_ID' first."
    exit 1
fi
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
echo "✅ Operating on Project ID: ${PROJECT_ID}"
echo "---"
PRIMORDIA_SA="primordia-sa@${PROJECT_ID}.iam.gserviceaccount.com"
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
echo "🔑 Creating the Primordia service account: ${PRIMORDIA_SA}"
gcloud iam service-accounts create primordia-sa \
  --display-name="Primordia Bridge Service Account" \
  --project=$PROJECT_ID || echo "   - Service account already exists. Skipping creation."
echo "---"
echo " granting permissions to the Cloud Build service..."
echo "   - Granting role: roles/run.admin"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin" --quiet
echo "   - Granting role: roles/iam.serviceAccountUser (on Primordia SA)"
gcloud iam service-accounts add-iam-policy-binding $PRIMORDIA_SA \
    --member="serviceAccount:${CLOUDBUILD_SA}" \
    --role="roles/iam.serviceAccountUser" --quiet
echo "---"
echo " granting permissions to the Primordia application..."
echo "   - Granting role: roles/datastore.user (for Firestore)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/datastore.user" --quiet
echo "   - Granting role: roles/storage.admin (for GCS Workspace)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/storage.admin" --quiet
echo "   - Granting role: roles/pubsub.publisher (for API Health Check)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/pubsub.publisher" --quiet
echo "   - Granting role: roles/pubsub.subscriber (for Worker)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/pubsub.subscriber" --quiet
echo "   - Granting role: roles/cloudbuild.builds.editor (for Worker)"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PRIMORDIA_SA}" \
  --role="roles/cloudbuild.builds.editor" --quiet
echo "---"
echo "✅ All required IAM permissions for Primordia have been configured successfully!"
