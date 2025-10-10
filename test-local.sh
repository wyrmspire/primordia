#!/bin/bash
# -----------------------------------------------------------
# Primordia Project — UNIFIED Local Pre-Flight Test Suite
#
# This ONE script handles everything:
# 1. Starts the local server in the background.
# 2. Waits for the server to be ready.
# 3. Runs all tests.
# 4. Automatically shuts down the server on exit.
# -----------------------------------------------------------

# Exit immediately if any command fails
set -e

# --- Cleanup Function ---
# This function is called automatically when the script exits for any reason.
cleanup() {
  echo ""
  echo "-----------------------------------------"
  echo "🧹 Cleaning up..."
  # Check if the SERVER_PID variable is set
  if [ -n "$SERVER_PID" ]; then
    echo "🔴 Stopping server (PID: $SERVER_PID)..."
    # Kill the server process. The `-` before the PID kills the process group.
    kill -TERM -- "$SERVER_PID" 2>/dev/null || true
  fi
}

# The 'trap' command ensures the 'cleanup' function is always called on exit.
trap cleanup EXIT

# --- Server Startup ---
echo "✅ Reading configuration from .env file..."
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting local server in the background..."
npm start &
SERVER_PID=$! # Capture the Process ID of the server

# --- Wait for Server ---
echo "⏳ Waiting for the server to become available..."
for i in {1..15}; do
  # Use curl to ping the healthz endpoint silently.
  if curl -fsS -o /dev/null "http://localhost:8080/healthz"; then
    echo "✅ Server is up and running!"
    break
  fi
  # If the server is not ready, wait a second.
  if [ $i -eq 15 ]; then
    echo "❌ FATAL: Server failed to start within 15 seconds."
    exit 1
  fi
  sleep 1
done

echo "-----------------------------------------"
echo "🚀  Starting Primordia local test suite..."
echo "-----------------------------------------"

# --- Helper Function for Logging ---
step() { echo "🧪  Testing: $1..."; }
pass() { echo "✅  PASS: $1"; echo ""; }

# --- Test Definitions ---

# 1. Test the Health Check Endpoint
step "GET http://localhost:8080/healthz"
RESPONSE=$(curl -fsS "http://localhost:8080/healthz")
if [[ "$RESPONSE" != "🚀 Primordia Bridge OK" ]]; then
  echo "❌  FAIL: Health check did not return the expected message."
  exit 1
fi
pass "/healthz is responsive and correct."

# 2. Test the File Listing Endpoint
step "GET http://localhost:8080/files"
curl -fsS "http://localhost:8080/files" | jq -e '.files | arrays' > /dev/null
pass "/files returns a valid JSON object with a 'files' array."

# 3. Test the Firestore GET Endpoint (Negative Test)
step "GET http://localhost:8080/firestore/document?path=test-suite/non-existent-doc"
FS_RESPONSE=$(curl -fsS "http://localhost:8080/firestore/document?path=test-suite/non-existent-doc")
if [[ "$FS_RESPONSE" != "null" ]]; then
  echo "❌  FAIL: Firestore GET did not return 'null' for a non-existent document. Response was: ${FS_RESPONSE}"
  exit 1
fi
pass "/firestore/document correctly handles non-existent documents."

# --- End of Tests ---
echo "-----------------------------------------"
echo "🎉  All local tests passed successfully!"
