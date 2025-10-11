#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "🚀 Starting Project Primordia Refactor Setup..."

# --- 1. Create the new directory structure ---
echo "  [1/5] Creating new source directory structure..."
mkdir -p src/api
mkdir -p src/worker
mkdir -p src/shared
echo "      ✅ Directories src/api, src/worker, src/shared created."

# --- 2. Move existing files into the new structure ---
# We'll move core logic files. Config files like Dockerfile stay at the root.
echo "  [2/5] Migrating existing files..."
# Use a for loop to handle cases where a file might not exist.
FILES_TO_MOVE=("cache.js" "deploy.js" "firestore.js" "logs.js" "sandbox.js" "scaffold.js" "storage.js" "tasks.js" "utils.js")
for file in "${FILES_TO_MOVE[@]}"; do
    if [ -f "$file" ]; then
        mv "$file" "src/shared/"
        echo "      Moved $file -> src/shared/"
    else
        echo "      Skipping $file (not found)."
    fi
done

# Move the main server file
if [ -f "index.js" ]; then
    mv "index.js" "src/api/index.js"
    echo "      Moved index.js -> src/api/index.js"
else
    echo "      Skipping index.js (not found)."
fi

echo "      ✅ File migration complete."

# --- 3. Install new npm dependencies ---
echo "  [3/5] Installing new npm dependencies (concurrently, @google-cloud/pubsub)..."
# Check if dependencies are already in package.json to avoid unnecessary installs
if ! grep -q "concurrently" package.json; then
    npm install concurrently --save
else
    echo "      'concurrently' already installed."
fi
if ! grep -q "@google-cloud/pubsub" package.json; then
    npm install @google-cloud/pubsub --save
else
    echo "      '@google-cloud/pubsub' already installed."
fi
echo "      ✅ Dependencies are up to date."

# --- 4. Update package.json scripts ---
echo "  [4/5] Updating npm scripts in package.json..."
# This command uses jq, a command-line JSON processor. It's a robust way to edit JSON.
# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo "      ⚠️ 'jq' is not installed. Manually update your package.json scripts:"
    echo '      "start": "node src/api/index.js",'
    echo '      "dev:api": "node src/api/index.js",'
    echo '      "dev:worker": "node src/worker/index.js",'
    echo '      "dev": "concurrently \"npm:dev:*\""'
else
    # Create a backup and then update the scripts
    cp package.json package.json.bak
    jq '.scripts = {
        "start": "node src/api/index.js",
        "dev:api": "node src/api/index.js",
        "dev:worker": "node src/worker/index.js",
        "dev": "concurrently \"npm:dev:*\""
    } + .scripts' package.json.bak > package.json
    rm package.json.bak
    echo "      ✅ npm scripts updated."
fi


# --- 5. Create placeholder worker file ---
echo "  [5/5] Creating placeholder worker file..."
WORKER_FILE="src/worker/index.js"
if [ ! -f "$WORKER_FILE" ]; then
    cat <<EOF > "$WORKER_FILE"
// Primordia Worker Service
// This service will listen for jobs on a Pub/Sub subscription.

console.log("🛠️ Primordia Worker starting...");

function main() {
  console.log("   - Worker is running and ready to listen for jobs.");
  // TODO: Add Pub/Sub subscription logic here.
}

main();

// Keep the process alive. In a real scenario, the Pub/Sub listener does this.
setInterval(() => {}, 1000 * 60 * 60);
EOF
    echo "      ✅ Placeholder src/worker/index.js created."
else
    echo "      ✅ src/worker/index.js already exists."
fi

echo ""
echo "🎉 Refactor setup complete!"
echo ""
echo "--- Next Steps ---"
echo "1. In a NEW terminal, start the Pub/Sub emulator:"
echo "   gcloud beta emulators pubsub start"
echo ""
echo "2. The emulator will give you an environment variable. In THIS terminal, export it:"
echo "   export PUBSUB_EMULATOR_HOST=localhost:XXXX"
echo ""
echo "3. Run the new local development environment:"
echo "   npm run dev"
echo ""
echo "You should see output from both the API and the Worker services."