#!/bin/bash
# A script to create a clean, shareable zip archive of the Primordia source code.

# Exit immediately if a command fails.
set -e

OUTPUT_FILE="primordia-source.zip"

# Clean up any previous archive.
rm -f $OUTPUT_FILE

echo "📦 Creating clean source archive: ${OUTPUT_FILE}"

# Zip the current directory recursively, excluding specified patterns.
# The '-x' flag excludes files/directories.
zip -r $OUTPUT_FILE . \
  -x "*.git*" \
  -x "node_modules/*" \
  -x "cache/*" \
  -x ".env" \
  -x ".idea/*" \
  -x ".vscode/*" \
  -x "npm-debug.log*" \
  -x "yarn-debug.log*" \
  -x "yarn-error.log*" \
  -x "*.DS_Store" \
  -x "${OUTPUT_FILE}" \
  -x "test-local.sh"

echo "✅ Success! Archive created at ./${OUTPUT_FILE}"
