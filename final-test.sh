#!/bin/bash
# -----------------------------------------------------------------------------
# Primordia Platform - Final End-to-End Verification Test
#
# This script validates the entire live cloud platform by:
# 1. Checking the health of the main Primordia service.
# 2. Writing the source code for a new test service to the workspace.
# 3. Submitting a 'deploy-run-service' job.
# 4. Monitoring the job until it completes successfully.
# 5. Calling the newly deployed service through the proxy to confirm it works.
# -----------------------------------------------------------------------------

# Exit immediately if any command fails
set -e

echo "🚀 Starting Grand Finale Cloud Verification..."
echo "---"

# --- [Step 1] SETUP & HEALTH CHECK ---
echo "[1/4] Setting up environment and checking Primordia health..."

# Manually set the service URL since it's known
SERVICE_URL="https://primordia-wyd2wy7zrq-uc.a.run.app"

# Create a unique name for our test service to ensure a clean workspace
TIMESTAMP=$(date +%s)
TEST_SERVICE_NAME="e2e-final-test-${TIMESTAMP}"

echo "  - Primordia Bridge URL: ${SERVICE_URL}"
echo "  - New Service Name:     ${TEST_SERVICE_NAME}"

# Health Check
if ! curl -sSf "${SERVICE_URL}/healthz" > /dev/null; then
    echo "❌ FAILED: Primordia health check failed. Aborting."
    exit 1
fi
echo "✅ Primordia service is healthy."
echo "---"

# --- [Step 2] WRITE SOURCE CODE ---
echo "[2/4] Writing source files for '${TEST_SERVICE_NAME}' to the workspace..."
# Write package.json with the necessary 'start' script
curl -s -X POST "${SERVICE_URL}/file" -H "Content-Type: application/json" -d @- <<EOF > /dev/null
{
  "path": "runs/${TEST_SERVICE_NAME}/package.json",
  "content": "{\"name\":\"${TEST_SERVICE_NAME}\",\"type\":\"module\",\"main\":\"handler.js\",\"scripts\":{\"start\":\"node handler.js\"},\"dependencies\":{\"express\":\"^4.19.2\"}}"
}
EOF
# Write handler.js with a simple success message
curl -s -X POST "${SERVICE_URL}/file" -H "Content-Type: application/json" -d @- <<EOF > /dev/null
{
  "path": "runs/${TEST_SERVICE_NAME}/handler.js",
  "content": "import express from 'express'; const app = express(); app.get('/', (req, res) => res.json({ service: '${TEST_SERVICE_NAME}', message: 'Verification successful!', status: 'OK' })); app.listen(process.env.PORT || 8080);"
}
EOF
echo "✅ Source files written successfully."
echo "---"

# --- [Step 3] SUBMIT AND MONITOR DEPLOYMENT JOB ---
echo "[3/4] Submitting 'deploy-run-service' job and monitoring..."
JOB_ID=$(curl -s -X POST "${SERVICE_URL}/workspace" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"deploy-run-service\", \"name\": \"${TEST_SERVICE_NAME}\"}" \
  | jq -r '.jobId')

if [ -z "$JOB_ID" ]; then
  echo "❌ FAILED: Did not receive a Job ID from the API."
  exit 1
fi
echo "✅ Job submitted. JOB_ID: ${JOB_ID}. Monitoring..."

while true; do
  STATUS_JSON=$(curl -s "${SERVICE_URL}/workspace/status/${JOB_ID}")
  STATUS=$(echo "$STATUS_JSON" | jq -r '.status')
  LAST_LOG=$(echo "$STATUS_JSON" | jq -r '.logs[-1]')

  echo "  - Current status: ${STATUS} | Last Log: ${LAST_LOG}"

  if [ "$STATUS" = "SUCCESS" ] || [ "$STATUS" = "FAILED" ]; then
    echo "✅ Job reached final state: ${STATUS}"
    break
  fi
  sleep 15
done

if [ "$STATUS" != "SUCCESS" ]; then
  echo "❌ FAILED: Deployment job did not succeed."
  exit 1
fi
echo "---"

# --- [Step 4] VERIFY VIA PROXY ---
echo "[4/4] Verifying the new service via the Primordia Proxy..."
TARGET_SVC_URL=$(gcloud run services describe ${TEST_SERVICE_NAME} --region us-central1 --format='value(status.url)')
echo "  - Pinging new service at ${TARGET_SVC_URL} through the proxy..."

PROXY_RESPONSE=$(curl -s -X POST "${SERVICE_URL}/workspace/proxy" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${TARGET_SVC_URL}\"}")

# Check if the proxy call itself was successful
PROXY_OK=$(echo "$PROXY_RESPONSE" | jq -r '.ok')
if [ "$PROXY_OK" != "true" ]; then
    echo "❌ FAILED: Proxy call returned an error."
    echo "$PROXY_RESPONSE" | jq
    exit 1
fi

# Check if the body of the proxied response contains our success message
PROXY_BODY_MESSAGE=$(echo "$PROXY_RESPONSE" | jq -r '.body.value' | jq -r '.message')
if [ "$PROXY_BODY_MESSAGE" = "Verification successful!" ]; then
    echo "✅ Proxy call successful and returned the correct message."
else
    echo "❌ FAILED: Proxy call succeeded, but the response body was incorrect."
    echo "$PROXY_RESPONSE" | jq
    exit 1
fi
echo "---"

echo -e "\n🎉🎉🎉 GRAND FINALE SUCCESS! The entire platform is verified. 🎉🎉🎉"