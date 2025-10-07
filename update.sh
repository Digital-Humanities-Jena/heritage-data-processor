#!/bin/bash

# A script to update existing files in the CODEBASE directory with their latest versions
# from the current working directory, without adding new files.
# This version handles directories recursively, updating only existing files within them.

# --- Configuration ---
TARGET_DIR="./codebase"

# --- Main Script Execution ---

echo "🔍 Checking current contents of $TARGET_DIR..."

# Check if target directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "❌ Error: $TARGET_DIR directory does not exist!"
    echo "   Create it first or run the initial setup script."
    exit 1
fi

# Get list of all files and directories in the target directory (top level)
EXISTING_ITEMS=()
while IFS= read -r -d '' item; do
    # Remove the ./codebase/ prefix to get relative paths
    relative_path="${item#$TARGET_DIR/}"
    # Skip if it's just the target directory itself
    if [ "$relative_path" != "$TARGET_DIR" ] && [ "$relative_path" != "." ]; then
        EXISTING_ITEMS+=("$relative_path")
    fi
done < <(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -print0)

if [ ${#EXISTING_ITEMS[@]} -eq 0 ]; then
    echo "📭 $TARGET_DIR is empty - nothing to update."
    exit 0
fi

echo "📋 Found ${#EXISTING_ITEMS[@]} top-level items to check:"
printf "   - %s\n" "${EXISTING_ITEMS[@]}"
echo ""

# Update each existing item
echo "🔄 Processing existing files and directories..."
total_updated=0
total_skipped=0

for item in "${EXISTING_ITEMS[@]}"; do
    echo "🔍 Processing: $item"
    
    source_path="$item"
    target_path="$TARGET_DIR/$item"
    
    # Check if the source item exists in current directory
    if [ -e "$source_path" ]; then
        if [ -f "$source_path" ]; then
            # It's a file - simple update
            echo "  ✅ Source file found - updating..."
            cp "$source_path" "$target_path"
            ((total_updated++))
            echo "  ✨ Updated file: $item"
        elif [ -d "$source_path" ]; then
            # It's a directory - recursively update only existing files within it
            echo "  📁 Source directory found - updating existing contents only..."
            
            # Count files before update
            files_before=$(find "$target_path" -type f | wc -l)
            
            # Find all existing files in the target directory recursively
            updated_in_dir=0
            while IFS= read -r -d '' target_file; do
                # Get relative path from target directory
                relative_file_path="${target_file#$target_path/}"
                
                # Skip if it's the directory itself
                if [ "$relative_file_path" = "$target_path" ]; then
                    continue
                fi
                
                # Construct source file path
                source_file="$source_path/$relative_file_path"
                
                if [ -f "$target_file" ] && [ -f "$source_file" ]; then
                    echo "    ✅ Updating: $item/$relative_file_path"
                    # Ensure parent directory exists in case of nested structure
                    mkdir -p "$(dirname "$target_file")"
                    cp "$source_file" "$target_file"
                    ((updated_in_dir++))
                fi
            done < <(find "$target_path" -type f -print0)
            
            # Count files after update to verify no new files were added
            files_after=$(find "$target_path" -type f | wc -l)
            
            echo "    📊 Updated $updated_in_dir files in directory $item"
            echo "    📊 File count: $files_before → $files_after (should be same)"
            
            total_updated=$((total_updated + updated_in_dir))
        fi
    else
        echo "  ⚠️  Source not found in current directory - skipping"
        ((total_skipped++))
    fi
    echo ""
done

# Summary
echo "📊 Update Summary:"
echo "   ✅ Updated: $total_updated files"
echo "   ⚠️  Skipped: $total_skipped items (source not found)"
echo ""

# Verify the result
echo "🔍 Final verification - current structure of $TARGET_DIR:"
find "$TARGET_DIR" -type f | head -20
file_count=$(find "$TARGET_DIR" -type f | wc -l)
echo "📁 Total files in $TARGET_DIR: $file_count"
