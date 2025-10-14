#!/bin/bash
set -e

# --- Configuration ---
OUTPUT_FILE="primordia_code.md"
EXCLUDE_DIRS=("./node_modules/*" "./.git/*" "./cache/*")
EXCLUDE_FILES=("*.zip" "*.log" "*.bak" ".DS_Store" "package-lock.json" "$OUTPUT_FILE")

# --- Script Start ---
echo "🚀 Printing project source code to $OUTPUT_FILE..."

# Initialize the output file with a title
echo "# Primordia Project: Source Code Snapshot" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Build the find command's exclusion list
FIND_EXCLUDES=""
for dir in "${EXCLUDE_DIRS[@]}"; do
    FIND_EXCLUDES="$FIND_EXCLUDES -not -path \"$dir\""
done
for file in "${EXCLUDE_FILES[@]}"; do
    FIND_EXCLUDES="$FIND_EXCLUDES -not -name \"$file\""
done

# Find all relevant files, excluding specified directories and files
# The strange 'eval' is used to correctly handle the constructed exclusion string
eval find . -type f $FIND_EXCLUDES | sort | while read -r file; do
    echo "   - Processing $file"

    # Get file extension for syntax highlighting hint
    extension="${file##*.}"
    lang=""
    case "$extension" in
        js) lang="javascript" ;;
        json) lang="json" ;;
        sh) lang="bash" ;;
        yaml) lang="yaml" ;;
        md) lang="markdown" ;;
        Dockerfile) lang="dockerfile" ;;
        *) lang="" ;;
    esac

    # Append file content to the markdown file
    echo "---" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "## File: \`$file\`" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "\`\`\`$lang" >> "$OUTPUT_FILE"
    cat "$file" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "\`\`\`" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
done

echo ""
echo "✅ Done. All relevant code has been printed to $OUTPUT_FILE."

