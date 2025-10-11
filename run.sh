#!/bin/bash
# -----------------------------------------------------------
# Primordia Project — Unified "Golden Path" Runner
#
# This ONE script handles the entire deployment lifecycle:
# 1. Runs local tests.
# 2. Adds all changes to Git.
# 3. Commits with a message you provide.
# 4. Pushes to the remote repository.
# 5. Deploys the service.
# -----------------------------------------------------------

# Exit immediately if any command fails
set -e

# --- 1. Validate Input ---
# Check if a commit message was provided as an argument.
if [ -z "$1" ]; then
  echo "❌ ERROR: A commit message is required."
  echo "   Usage: ./run.sh \"Your descriptive commit message\""
  exit 1
fi
COMMIT_MESSAGE="$1"

echo "-----------------------------------------"
echo " Golden Path Initiated..."
echo " Commit Message: \"$COMMIT_MESSAGE\""
echo "-----------------------------------------"

# --- 2. Run Local Tests ---
echo "🧪 [Step 1/5] Running local pre-flight checks..."
./test-local.sh
echo "✅ Local tests passed."
echo ""

# --- 3. Add Changes ---
echo "➕ [Step 2/5] Staging all changes..."
git add .
echo "✅ All changes staged."
echo ""

# --- 4. Commit ---
echo "💾 [Step 3/5] Committing changes..."
git commit -m "$COMMIT_MESSAGE"
echo "✅ Changes committed."
echo ""

# --- 5. Push ---
echo "⬆️  [Step 4/5] Pushing to remote repository..."
git push
echo "✅ Push complete."
echo ""

# --- 6. Deploy ---
echo "🚀 [Step 5/5] Deploying the Primordia Bridge..."
./deploy.sh

echo ""
echo "-----------------------------------------"
echo "🎉 Golden Path Complete! Deployment is live."
echo "-----------------------------------------"
