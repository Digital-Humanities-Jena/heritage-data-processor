#!/bin/bash

# ==============================================================================
# Heritage Data Processor CLI - Corrected End-to-End Workflow Test
# ==============================================================================
# This script performs a single, clean, end-to-end test of the 'run-pipeline'
# command, which is the primary intended workflow for the CLI.
#
# Prerequisites:
#   - Backend server must be running.
#   - A mapping_config.yaml and metadata.xlsx must exist.
# ==============================================================================

set -e

# --- Configuration ---
HDPC_FILE="../server_app/tests/cli_e2e_project.hdpc"
INPUT_DIR="../server_app/tests/images"
OUTPUT_DIR="../server_app/tests/output"
METADATA_SPREADSHEET="../server_app/tests/mapping/test.xlsx"
MAPPING_CONFIG_YAML="../server_app/tests/mapping/mapping_config.yaml"
PIPELINE_NAME="a002" # This pipeline should handle the full workflow

# --- Helper Function ---
step() {
    echo ""
    echo "=============================================================================="
    echo "➡️  STEP: $1"
    echo "=============================================================================="
}

# --- Cleanup: Remove the old project file to ensure a fresh start ---
step "Cleaning up previous project file"
rm -f "$HDPC_FILE"
echo "✅ Cleaned up previous .hdpc file."

# --- Step 1: Create a new project ---
step "Creating new HDPC project file"
python server_app/cli.py create-project \
    --hdpc-path "$HDPC_FILE" \
    --project-name "CLI E2E Test Project" \
    --short-code "CLI-E2E" \
    --modality "Image / Photography"

# --- Step 2: Configure the project's paths and metadata mapping ---
step "Setting up project paths and configuring metadata mapping"
python server_app/cli.py setup-project \
    --hdpc "$HDPC_FILE" \
    --input-dir "$INPUT_DIR" \
    --output-dir "$OUTPUT_DIR"

python server_app/cli.py configure-mapping \
    --hdpc "$HDPC_FILE" \
    --file "$METADATA_SPREADSHEET" \
    --mapping-config "$MAPPING_CONFIG_YAML"

# --- Step 3: Run the complete end-to-end pipeline ---
step "Executing the all-in-one 'run-pipeline' command"
# This single command will now handle:
# 1. Finding local files.
# 2. Creating records in the local DB.
# 3. Preparing metadata.
# 4. Creating drafts on Zenodo.
# 5. Running all component steps.
# 6. Uploading all necessary files.
# 7. Publishing the final records.
python server_app/cli.py run-pipeline \
    --hdpc "$HDPC_FILE" \
    --pipeline "$PIPELINE_NAME" \
    --input-dir "$INPUT_DIR" \
    --extensions .jpg .png \
    --sandbox

# --- Final Success Message ---
echo ""
echo "=============================================================================="
echo "✅🎉 CLI End-to-End Test Completed Successfully!"
echo "=============================================================================="
echo ""