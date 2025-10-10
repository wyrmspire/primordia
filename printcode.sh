#!/bin/bash
# A script to concatenate all relevant project source files into a single Markdown file.

# Exit immediately if a command fails.
set -e

OUTPUT_FILE="printcode.md"
SOURCE_FILES=(
  "package.json"
  "Dockerfile"
  ".gcloudignore"
  "cloudbuild.yaml"
  "deploy.sh"
  "*.js"
)

# Clean up the old file and create a new one with a title.
rm -f $OUTPUT_FILE
echo "# Primordia Project Source Code Snapshot" > $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

# Loop through the list of source files/patterns.
for pattern in "${SOURCE_FILES[@]}"; do
  # Loop through files that match the pattern to handle wildcards like *.js
  for file in $pattern; do
    # Check if the file actually exists to avoid errors with patterns that find no files
    if [ -f "$file" ]; then
      echo "📄 Adding ${file}..."
      
      # Determine the language for Markdown syntax highlighting based on extension
      lang=""
      case "$file" in
        *.js)           lang="javascript" ;;
        *.sh)           lang="bash" ;;
        *.json)         lang="json" ;;
        *.yaml)         lang="yaml" ;;
        *Dockerfile*)   lang="dockerfile" ;;
        *)              lang="plaintext" ;;
      esac
      
      # Append the file content to the Markdown file
      echo -e "\n---\n" >> $OUTPUT_FILE
      echo "## File: \`${file}\`" >> $OUTPUT_FILE
      echo "" >> $OUTPUT_FILE
      echo "\`\`\`${lang}" >> $OUTPUT_FILE
      cat "$file" >> $OUTPUT_FILE
      echo -e "\n\`\`\`" >> $OUTPUT_FILE
    fi
  done
done

echo ""
echo "✅ Success! All source code has been printed to ${OUTPUT_FILE}"
