#!/bin/bash
# This script creates a clean zip archive of the Primordia source code.

OUTPUT_FILE="primordia-source.zip"

# Remove the old zip file if it exists
rm -f $OUTPUT_FILE

echo "Creating clean archive: ${OUTPUT_FILE}"

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
  -x "${OUTPUT_FILE}"

echo "✅ Done. Archive created at ./${OUTPUT_FILE}"
