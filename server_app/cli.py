#!/usr/bin/env python
# cli.py
"""
Command-Line Interface for the Heritage Data Processor Application.

This script provides command-line access to the core functionalities of the
Heritage Data Processor backend, such as running pipelines and publishing records.

This new workflow separates uploading/draft creation from pipeline processing
to ensure the pipeline only runs on records that are fully prepared.

WORKFLOW:
1. Use the 'upload' command to add files and create Zenodo drafts.
   e.g., python main.py upload --hdpc "project.hdpc" --input-dir "/path/to/files"

2. Use the 'process' command to run a pipeline on all existing drafts.
   e.g., python main.py process --hdpc "project.hdpc" --pipeline "pipeline-name"
"""
import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

import requests

# --- Configuration ---
API_BASE_URL = "http://localhost:5001/api"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    stream=sys.stdout,
)

# Default file extensions if the --extensions flag is not provided
DEFAULT_EXTENSIONS = {
    # Images
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".tif",
    ".tiff",
    ".bmp",
    ".svg",
    # Documents
    ".pdf",
    ".docx",
    ".xlsx",
    ".pptx",
    ".txt",
    ".csv",
    ".md",
    # 3D Models
    ".obj",
    ".stl",
    ".ply",
    ".fbx",
    ".gltf",
}


class ZenodoToolboxClient:
    """A client to interact with the Heritage Data Processor server API."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def _post(self, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Helper for POST requests."""
        try:
            response = self.session.post(f"{self.base_url}{endpoint}", json=data)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"API call to {endpoint} failed: {e}")
            if e.response is not None:
                logging.error(f"Server response: {e.response.text}")
            sys.exit(1)

    def _get(self, endpoint: str, params: Dict = None) -> Dict[str, Any]:
        """Helper for GET requests."""
        try:
            response = self.session.get(f"{self.base_url}{endpoint}", params=params or {})
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"API call to {endpoint} failed: {e}")
            if e.response is not None:
                logging.error(f"Server response: {e.response.text}")
            sys.exit(1)

    def load_project(self, hdpc_path: str):
        """Loads a HDPC project on the server."""
        logging.info(f"Loading project: {hdpc_path}")
        result = self._post("/hdpc/load", data={"path": hdpc_path})
        logging.info(f"Successfully loaded project: {result.get('project_name')}")

    def add_files_to_project(
        self, input_dir: str, extensions: Optional[List[str]] = None, recursive: bool = False
    ) -> List[str]:
        """Adds files from a directory, supporting recursive search and filtering."""
        logging.info(f"Scanning {'recursively' if recursive else 'root of'} directory: {input_dir}")
        input_path = Path(input_dir)
        if not input_path.is_dir():
            logging.error(f"Input directory not found: {input_dir}")
            sys.exit(1)

        glob_pattern = "**/*" if recursive else "*"
        all_files = [p for p in input_path.glob(glob_pattern) if p.is_file()]

        # Determine which extensions to use for filtering
        target_extensions = {f".{ext.lstrip('.').lower()}" for ext in extensions} if extensions else DEFAULT_EXTENSIONS
        logging.info(f"Filtering for files with extensions: {', '.join(target_extensions)}")

        files_to_process = [p for p in all_files if p.suffix.lower() in target_extensions]

        if not files_to_process:
            logging.warning("No files matching the filter were found.")
            return []

        file_paths = [str(p.resolve()) for p in files_to_process]
        logging.info(f"Found {len(file_paths)} files. Adding to project...")

        # The backend API handles adding files efficiently
        result = self._post("/project/source_files/add", data={"absolute_file_paths": file_paths})
        logging.info(
            f"File addition complete. Added: {result.get('added_count', 0)}, "
            f"Skipped: {result.get('skipped_existing_path', 0)}"
        )
        return file_paths  # Return the list of added paths for subsequent steps

    def get_records_by_tab(
        self,
        tab_id: str,
        is_sandbox: bool = True,
        search: Optional[str] = None,
        title_pattern: Optional[str] = None,
        date_since: Optional[str] = None,
        date_until: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves records from a specific tab with optional server-side filtering."""
        params = {"tab_id": tab_id, "is_sandbox": is_sandbox}
        # Add optional filter parameters if they are provided
        if search:
            params["search"] = search
        if title_pattern:
            params["title_pattern"] = title_pattern
        if date_since:
            params["date_since"] = date_since
        if date_until:
            params["date_until"] = date_until

        return self._get("/project/uploads_by_tab", params=params)

    def prepare_metadata_for_file(self, source_file_id: int):
        """Triggers metadata preparation for a specific file."""
        logging.info(f"Preparing metadata for source file ID: {source_file_id}")
        self._post("/project/prepare_metadata_for_file", data={"source_file_db_id": source_file_id})
        logging.info(f"Successfully prepared metadata for file {source_file_id}.")

    def create_api_draft(self, local_record_id: int):
        """Creates a Zenodo draft using the dedicated CLI endpoint."""
        logging.info(f"Creating Zenodo draft for local record ID: {local_record_id} via CLI endpoint.")
        self._post("/project/cli/create_api_draft", data={"local_record_db_id": local_record_id})
        logging.info(f"Successfully created Zenodo draft for record {local_record_id}.")

    def execute_pipeline(self, pipeline_name: str, record_ids: List[int]):
        """Executes a specified pipeline on a list of record IDs and waits for completion."""
        if not record_ids:
            logging.warning("No record IDs provided to execute pipeline on. Skipping.")
            return
        logging.info(f"Executing pipeline '{pipeline_name}' on {len(record_ids)} records. This may take some time...")

        # This endpoint is synchronous, so the client will wait for it to finish.
        result = self._post(f"/pipelines/{pipeline_name}/execute", data={"record_ids": record_ids})

        # Process the detailed response from the synchronous backend.
        if result.get("success"):
            logging.info(f"Pipeline execution completed successfully: {result.get('message')}")
        else:
            # The backend sends back a consolidated error message.
            logging.error(
                f"Pipeline execution failed: {result.get('error', 'An unknown error occurred on the server.')}"
            )
            sys.exit(1)  # Best practice: exit with an error code on failure.

    def publish_record(self, local_record_id: int) -> Dict[str, Any]:
        """Publishes a Zenodo draft and returns the full result."""
        logging.info(f"Publishing record ID: {local_record_id}")
        # This call points to the single-item publish endpoint, not a batch one
        result = self._post("/project/publish_record", data={"local_record_db_id": local_record_id})
        return result

    def batch_prepare_metadata(self, file_ids: List[int], is_sandbox: bool) -> Dict[str, Any]:
        """Uses the batch action endpoint to prepare metadata for multiple files."""
        logging.info(f"Sending batch request to prepare metadata for {len(file_ids)} files.")
        return self._post(
            "/project/batch_action",
            data={"action_type": "prepare_metadata", "item_ids": file_ids, "target_is_sandbox": is_sandbox},
        )

    def batch_create_drafts(self, record_ids: List[int]) -> Dict[str, Any]:
        """Uses the batch action endpoint to create drafts for multiple records."""
        logging.info(f"Sending batch request to create drafts for {len(record_ids)} records.")
        return self._post("/project/batch_action", data={"action_type": "create_api_draft", "item_ids": record_ids})

    def batch_discard_drafts(self, record_ids: List[int]) -> Dict[str, Any]:
        """Uses the batch action endpoint to discard multiple drafts."""
        logging.info(f"Sending batch request to discard {len(record_ids)} drafts.")
        return self._post("/project/batch_action", data={"action_type": "discard_drafts", "item_ids": record_ids})

    def batch_upload_files(self, record_ids: List[int]) -> Dict[str, Any]:
        """Uses the batch action endpoint to upload files for multiple drafts."""
        logging.info(f"Sending batch request to upload files for {len(record_ids)} drafts.")
        return self._post("/project/batch_action", data={"action_type": "upload_main_files", "item_ids": record_ids})

    def create_project(self, hdpc_path: str, project_name: str, short_code: str, modality: str) -> Dict[str, Any]:
        """Calls the backend to create a new project file."""
        return self._post(
            "/project/create_initial",
            data={"hdpcPath": hdpc_path, "projectName": project_name, "shortCode": short_code, "modality": modality},
        )

    def setup_project(
        self, hdpc_path: str, data_in_path: str, data_out_path: str, batch_entity: str
    ) -> Dict[str, Any]:
        """Loads a project and calls the backend to configure its paths and scan for files."""
        self.load_project(hdpc_path)

        project_info = self._get("/project_info")
        project_id = project_info.get("project_id")
        if not project_id:
            raise Exception("Could not retrieve project ID after loading. Cannot proceed with setup.")

        return self._post(
            "/project/set_paths_and_scan",
            data={
                "hdpcPath": hdpc_path,
                "projectId": project_id,
                "dataInPath": data_in_path,
                "dataOutPath": data_out_path,
                "batchEntity": batch_entity,
            },
        )

    def match_files_for_versioning(
        self, directory_path: str, match_method: str, is_sandbox: bool
    ) -> List[Dict[str, Any]]:
        """Matches local files to published records."""
        result = self._post(
            "/project/match_files_for_versioning",
            data={"directory_path": directory_path, "match_method": match_method, "is_sandbox": is_sandbox},
        )
        return result.get("matches", [])

    def execute_versioning_pipeline(
        self, pipeline_name: str, concept_rec_id: str, file_manifest: dict, is_sandbox: bool
    ):
        """Executes a pipeline in versioning mode."""
        logging.info(f"Triggering versioning pipeline for concept {concept_rec_id}")
        result = self._post(
            f"/pipelines/{pipeline_name}/execute",
            data={"concept_rec_id": concept_rec_id, "file_manifest": file_manifest, "is_sandbox": is_sandbox},
        )
        if not result.get("success"):
            logging.error(f"Pipeline execution failed for concept {concept_rec_id}: {result.get('error')}")
            # Do not exit; allow other versions to be processed.
        else:
            logging.info(f"Successfully triggered pipeline for concept {concept_rec_id}")

    def configure_mapping(self, spreadsheet_path: str, mapping_yaml_path: str):
        """Reads a mapping YAML, combines it with file info, and saves it to the project."""
        import yaml

        try:
            with open(mapping_yaml_path, "r") as f:
                mapping_data = yaml.safe_load(f)
        except (IOError, yaml.YAMLError) as e:
            logging.error(f"Failed to read or parse mapping YAML file: {e}")
            sys.exit(1)

        # Best Practice: The backend expects a single configuration object.
        # It is constructed here on the client before sending.
        final_mapping_config = {
            "_mapping_mode": "file",
            "_file_path": str(Path(spreadsheet_path).resolve()),
            "_file_format": "excel" if spreadsheet_path.lower().endswith((".xlsx", ".xls")) else "csv",
        }

        # Add the crucial filename linkage
        filename_col = mapping_data.get("filename_column")
        if not filename_col:
            logging.error("Mapping YAML is missing the required 'filename_column' key.")
            sys.exit(1)
        final_mapping_config["filename"] = {"type": "column", "value": filename_col}

        # Add all other field mappings
        final_mapping_config.update(mapping_data.get("field_mappings", {}))

        logging.info("Sending mapping configuration to the backend.")
        self._post("/project/metadata/save_mapping", data={"mappingConfiguration": final_mapping_config})

    def run_pipeline(
        self, pipeline_name: str, input_dir: str, extensions: Optional[List[str]], recursive: bool, is_sandbox: bool
    ) -> Dict[str, Any]:
        """Finds local files and executes a full pipeline on them."""
        logging.info(f"Scanning {'recursively' if recursive else 'root of'} directory: {input_dir}")
        input_path = Path(input_dir)
        if not input_path.is_dir():
            logging.error(f"Input directory not found: {input_dir}")
            sys.exit(1)

        glob_pattern = "**/*" if recursive else "*"
        all_files = [p for p in input_path.glob(glob_pattern) if p.is_file()]

        target_extensions = {f".{ext.lstrip('.').lower()}" for ext in extensions} if extensions else DEFAULT_EXTENSIONS
        files_to_process = [str(p.resolve()) for p in all_files if p.suffix.lower() in target_extensions]

        if not files_to_process:
            logging.warning("No files matching the filter were found to run the pipeline on.")
            return {"success": True, "message": "No files to process."}

        logging.info(f"Found {len(files_to_process)} files. Triggering pipeline '{pipeline_name}'...")

        return self._post(
            f"/pipelines/{pipeline_name}/execute_on_local_files",
            data={"local_file_paths": files_to_process, "is_sandbox": is_sandbox},
        )


# --- Command Handlers ---
def handle_upload_command(args: argparse.Namespace):
    """
    Handles adding files, preparing metadata, and creating drafts with enhanced options and feedback.
    This workflow mirrors the GUI's "pending preparation" -> "pending operations" logic.
    """
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info("--- Starting CLI Upload and Draft Creation Workflow ---")

    # 1. Load the project
    client.load_project(args.hdpc)

    # 2. Add files from the specified directory
    added_files_paths = client.add_files_to_project(args.input_dir, args.extensions, args.recursive)
    if not added_files_paths:
        logging.info("No new files were added to the project. Exiting.")
        return

    # A short delay can help ensure the server has processed the file additions before the next query
    time.sleep(1)

    # 3. Prepare metadata for all newly added files
    logging.info("Fetching list of files pending metadata preparation...")
    pending_prep_records = client.get_records_by_tab("pending_preparation", args.sandbox)

    # Filter to only process files that were just added in this run
    new_file_ids_to_prep = {
        record["source_file_db_id"] for record in pending_prep_records if record["absolute_path"] in added_files_paths
    }

    if not new_file_ids_to_prep:
        logging.warning(
            "No newly added files require metadata preparation. This might happen if they already have prepared records."
        )
    else:
        logging.info(f"Found {len(new_file_ids_to_prep)} new files to prepare. Preparing metadata for each...")
        # Using the batch endpoint is more efficient than individual calls
        results = client.batch_prepare_metadata(list(new_file_ids_to_prep), args.sandbox)

        # Halt on failure to prevent proceeding with an incomplete batch
        if not results.get("success"):
            logging.error("Batch metadata preparation failed. Please review the errors below.")
            for item_result in results.get("results", []):
                if not item_result.get("success"):
                    error_message = item_result.get("error") or item_result.get("message")
                    logging.error(f"  - ID {item_result['id']}: {error_message}")

                    # Check for and print detailed validation errors if they exist.
                    if "validation_errors" in item_result:
                        logging.error("    Validation Details:")
                        for validation_error in item_result["validation_errors"]:
                            logging.error(f"      - {validation_error}")
            sys.exit(1)  # Exit with an error code

    # 4. Create drafts for all records that are now ready
    logging.info("Fetching list of records ready for draft creation...")
    pending_ops_records = client.get_records_by_tab("pending_operations", args.sandbox)

    if not pending_ops_records:
        logging.info("No records are ready for draft creation.")
    else:
        record_ids_to_create = [record["local_record_db_id"] for record in pending_ops_records]
        logging.info(f"Found {len(record_ids_to_create)} records ready for draft creation. Creating drafts...")
        results = client.batch_create_drafts(record_ids_to_create)

        if not results.get("success"):
            logging.error("Batch draft creation failed. Please review the errors below.")
            for item_result in results.get("results", []):
                if not item_result.get("success"):
                    logging.error(
                        f"  - ID {item_result['id']}: {item_result.get('error') or item_result.get('message')}"
                    )
            sys.exit(1)  # Exit with an error code

    # 5. Upload files for all newly created drafts
    logging.info("Uploading source files for all newly created drafts...")
    # We can reuse the record_ids_to_create from the previous step
    if record_ids_to_create:
        upload_results = client.batch_upload_files(record_ids_to_create)
        if not upload_results.get("success"):
            logging.error("Batch file upload failed. Please review the errors below.")
            for item_result in upload_results.get("results", []):
                if not item_result.get("success"):
                    logging.error(
                        f"  - ID {item_result['id']}: {item_result.get('error') or item_result.get('message')}"
                    )
            # We don't exit here, as some uploads might have succeeded.

    logging.info("--- CLI Upload and Draft Creation Workflow Complete ---")
    logging.info("Drafts and their associated files are now ready for publishing or processing.")

    logging.info("--- CLI Upload and Draft Creation Workflow Complete ---")
    logging.info("You can now use the 'process' command to run pipelines on the newly created drafts.")


def handle_process_command(args: argparse.Namespace):
    """Handles executing a pipeline on a filtered set of existing drafts."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Starting CLI Pipeline Processing Workflow for '{args.pipeline}' ---")

    # 1. Load the project
    client.load_project(args.hdpc)

    # 2. Fetch drafts using the new filtering capabilities
    logging.info(
        f"Fetching drafts from the {'Sandbox' if args.sandbox else 'Production'} environment with specified filters..."
    )
    drafts_to_process = client.get_records_by_tab(
        tab_id="drafts",
        is_sandbox=args.sandbox,
        search=args.search,
        title_pattern=args.title_pattern,
        date_since=args.since,
        date_until=args.until,
    )

    if not drafts_to_process:
        logging.warning("No drafts found matching the specified criteria. Nothing to process.")
        return

    record_ids_for_pipeline = [record["local_record_db_id"] for record in drafts_to_process]
    logging.info(f"Found {len(record_ids_for_pipeline)} drafts to process:")
    for record in drafts_to_process:
        logging.info(f"  - Record ID: {record['local_record_db_id']}, Title: '{record.get('record_title', 'N/A')}'")

    # 3. Execute the pipeline on the filtered list of record IDs
    client.execute_pipeline(args.pipeline, record_ids_for_pipeline)

    logging.info("--- CLI Pipeline Processing Workflow Complete ---")


def handle_publish_command(args: argparse.Namespace):
    """Handles publishing ready Zenodo drafts either selectively or in batch."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Starting CLI Publish Workflow ---")

    # 1. Load the project
    client.load_project(args.hdpc)

    # 2. Fetch all drafts from the specified environment
    env_name = "Sandbox" if args.sandbox else "Production"
    logging.info(f"Fetching drafts from the {env_name} environment...")
    all_drafts = client.get_records_by_tab("drafts", args.sandbox)

    if not all_drafts:
        logging.info("No drafts found in this environment. Nothing to publish.")
        return

    # 3. Filter drafts to find which ones are ready for publication
    # A draft is ready if all its associated files have been successfully uploaded.
    publishable_drafts = {
        d["local_record_db_id"]: d
        for d in all_drafts
        if d.get("uploaded_files_in_record") == d.get("total_files_in_record")
        and d.get("total_files_in_record", 0) > 0
    }

    if not publishable_drafts:
        logging.warning("Found drafts, but none have all their files uploaded. Nothing to publish.")
        return

    # 4. Determine which drafts to publish based on user input
    drafts_to_publish = []
    if args.record_ids:
        logging.info(f"Attempting to publish {len(args.record_ids)} specified record(s)...")
        for record_id in args.record_ids:
            if record_id in publishable_drafts:
                drafts_to_publish.append(publishable_drafts[record_id])
            else:
                # Check if the draft exists but is not ready
                if any(d["local_record_db_id"] == record_id for d in all_drafts):
                    logging.warning(
                        f"Skipping Record ID {record_id}: It exists but is not ready for publication (files may still be uploading)."
                    )
                else:
                    logging.warning(
                        f"Skipping Record ID {record_id}: It is not a valid or publishable draft ID in the {env_name} environment."
                    )

    elif args.all:
        drafts_to_publish = list(publishable_drafts.values())
        logging.info(f"Found {len(drafts_to_publish)} drafts ready for publication.")
        # Best Practice: Add a confirmation step for a potentially destructive batch operation.
        try:
            confirm = input(
                f"Are you sure you want to publish {len(drafts_to_publish)} drafts to {env_name}? This action cannot be undone. (yes/no): "
            )
            if confirm.lower() != "yes":
                logging.info("Publishing cancelled by user.")
                return
        except (EOFError, KeyboardInterrupt):
            logging.info("\nPublishing cancelled by user.")
            return

    if not drafts_to_publish:
        logging.error("No valid and ready drafts selected for publication. Exiting.")
        return

    # 5. Publish each selected draft and report individual status
    logging.info(f"--- Publishing {len(drafts_to_publish)} record(s) to {env_name} ---")
    success_count = 0
    failure_count = 0
    for draft in drafts_to_publish:
        record_id = draft["local_record_db_id"]
        title = draft.get("record_title", f"ID: {record_id}")
        result = client.publish_record(record_id)
        if result.get("success"):
            doi = result.get("zenodo_response", {}).get("doi", "N/A")
            logging.info(f"  [SUCCESS] Published '{title}'. DOI: {doi}")
            success_count += 1
        else:
            error = result.get("error", "Unknown error")
            logging.error(f"  [FAILURE] Failed to publish '{title}'. Reason: {error}")
            failure_count += 1

    logging.info("--- CLI Publish Workflow Complete ---")
    logging.info(f"Summary: {success_count} succeeded, {failure_count} failed.")


def handle_create_project_command(args: argparse.Namespace):
    """Handles the creation of a new project file."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Creating New Project: {args.project_name} ---")

    result = client.create_project(
        hdpc_path=args.hdpc_path, project_name=args.project_name, short_code=args.short_code, modality=args.modality
    )

    if result.get("success"):
        logging.info(f"Successfully created project file at: {result.get('hdpcPath')}")
        logging.info("Next, run the 'setup-project' command to configure data paths and scan for files.")
    else:
        logging.error(f"Failed to create project: {result.get('error')}")
        sys.exit(1)


def handle_setup_project_command(args: argparse.Namespace):
    """Handles configuring data paths and scanning files for an existing project."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Setting Up Project Paths and Scanning Files ---")

    # The setup command implicitly loads the project
    result = client.setup_project(
        hdpc_path=args.hdpc, data_in_path=args.input_dir, data_out_path=args.output_dir, batch_entity=args.batch_entity
    )

    if result.get("success"):
        logging.info("Project paths configured successfully.")
        logging.info(
            f"Initial file scan complete. Added: {result.get('filesAdded', 0)}, Skipped: {result.get('filesSkipped', 0)}"
        )
    else:
        logging.error(f"Failed to set up project: {result.get('error')}")


def handle_create_version_command(args: argparse.Namespace):
    """Handles the full workflow for creating a new version of records."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info("--- Starting New Version Creation Workflow ---")

    # 1. Load the project
    client.load_project(args.hdpc)

    # 2. Match local files to existing published records in the project
    logging.info(f"Matching files in '{args.input_dir}' using '{args.match_method}' method...")
    matched_records = client.match_files_for_versioning(
        directory_path=args.input_dir, match_method=args.match_method, is_sandbox=args.sandbox
    )

    if not matched_records:
        logging.warning("No matching published records found for the files in the input directory. Exiting.")
        return

    logging.info(f"Found {len(matched_records)} matching records to create new versions for.")

    # 3. Execute the versioning pipeline for each matched record
    for match in matched_records:
        concept_id = match["concept_rec_id"]
        title = match["record_title"]
        logging.info(f"Executing pipeline '{args.pipeline}' for '{title}' (Concept ID: {concept_id})")

        # The file manifest tells the backend which old files to keep and what the new source file is.
        # For the CLI, all previous files are kept and add the new one added.
        file_manifest = {
            "files_to_keep": ["*"],  # A pattern to keep all
            "new_source_file_path": match["matched_file_path"],
        }

        client.execute_versioning_pipeline(
            pipeline_name=args.pipeline,
            concept_rec_id=concept_id,
            file_manifest=file_manifest,
            is_sandbox=args.sandbox,
        )

    logging.info("--- New Version Creation Workflow Complete ---")
    logging.info("New drafts have been created. Run the 'publish' command to publish them.")


def handle_discard_drafts_command(args: argparse.Namespace):
    """Handles discarding Zenodo drafts either selectively or in batch."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Starting CLI Draft Discard Workflow ---")

    client.load_project(args.hdpc)
    env_name = "Sandbox" if args.sandbox else "Production"
    logging.info(f"Fetching drafts from the {env_name} environment to discard...")
    all_drafts = client.get_records_by_tab("drafts", args.sandbox)

    if not all_drafts:
        logging.info("No drafts found to discard.")
        return

    draft_ids_to_discard = []
    if args.record_ids:
        all_draft_ids = {d["local_record_db_id"] for d in all_drafts}
        for record_id in args.record_ids:
            if record_id in all_draft_ids:
                draft_ids_to_discard.append(record_id)
            else:
                logging.warning(f"Skipping Record ID {record_id}: Not a valid draft ID in this environment.")
    elif args.all:
        draft_ids_to_discard = [d["local_record_db_id"] for d in all_drafts]
        try:
            confirm = input(
                f"Are you sure you want to discard all {len(draft_ids_to_discard)} drafts from {env_name}? (yes/no): "
            )
            if confirm.lower() != "yes":
                logging.info("Discard action cancelled by user.")
                return
        except (EOFError, KeyboardInterrupt):
            logging.info("\nDiscard action cancelled by user.")
            return

    if not draft_ids_to_discard:
        logging.error("No valid drafts selected to discard. Exiting.")
        return

    results = client.batch_discard_drafts(draft_ids_to_discard)
    if results.get("success"):
        logging.info("Batch discard command executed successfully.")
    else:
        logging.error("Batch discard command failed.")


def handle_configure_mapping_command(args: argparse.Namespace):
    """Handles configuring metadata mapping from a spreadsheet and a YAML file."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Configuring Metadata Mapping for {args.hdpc} ---")
    client.load_project(args.hdpc)

    # The client method will handle reading the YAML and sending it to the backend.
    client.configure_mapping(spreadsheet_path=args.file, mapping_yaml_path=args.mapping_config)
    logging.info("Successfully configured and saved metadata mapping to the project.")


def handle_run_pipeline_command(args: argparse.Namespace):
    """Handles the unified end-to-end pipeline execution workflow on local files."""
    client = ZenodoToolboxClient(API_BASE_URL)
    logging.info(f"--- Starting End-to-End Pipeline Execution: '{args.pipeline}' ---")
    client.load_project(args.hdpc)

    result = client.run_pipeline(
        pipeline_name=args.pipeline,
        input_dir=args.input_dir,
        extensions=args.extensions,
        recursive=args.recursive,
        is_sandbox=args.sandbox,
    )

    if result.get("success"):
        logging.info(f"Pipeline workflow completed successfully: {result.get('message')}")
    else:
        logging.error(f"Pipeline workflow failed: {result.get('error', 'An unknown error occurred.')}")
        sys.exit(1)


def main():
    """Main function to parse arguments and dispatch commands."""
    parser = argparse.ArgumentParser(description="Heritage Data Processor CLI")
    subparsers = parser.add_subparsers(dest="command", required=True, help="Available commands")

    # --- Create Project Command ---
    create_parser = subparsers.add_parser("create-project", help="Create a new, empty .hdpc project file.")
    create_parser.add_argument(
        "--hdpc-path", required=True, help="Full path where the new .hdpc file will be created."
    )
    create_parser.add_argument("--project-name", required=True, help="A descriptive name for the project.")
    create_parser.add_argument(
        "--short-code", required=True, help="A short, unique code for the project (e.g., 'MyProject2025')."
    )
    create_parser.add_argument(
        "--modality",
        required=True,
        choices=[
            "Image / Photography",
            "3D Model",
            "Audio",
            "Video",
            "Text / Document",
            "Software",
            "Structured Information",
            "Multimodal Dataset",
        ],
        help="The primary data modality of the project.",
    )
    create_parser.set_defaults(func=handle_create_project_command)

    # --- Setup Project Command ---
    setup_parser = subparsers.add_parser(
        "setup-project", help="Configure data paths for a project and run an initial file scan."
    )
    setup_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    setup_parser.add_argument("--input-dir", required=True, help="Path to the directory containing source data.")
    setup_parser.add_argument(
        "--output-dir", required=True, help="Path to the directory where outputs will be stored."
    )
    setup_parser.add_argument(
        "--batch-entity",
        default="root",
        choices=["root", "subdirectory"],
        help="Processing mode: 'root' (one record per file) or 'subdirectory' (one record per folder).",
    )
    setup_parser.set_defaults(func=handle_setup_project_command)

    # --- Configure Mapping Command ---
    map_parser = subparsers.add_parser(
        "configure-mapping", help="Configure metadata mapping from a spreadsheet and a YAML config."
    )
    map_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    map_parser.add_argument("--file", required=True, help="Path to the CSV or Excel spreadsheet containing metadata.")
    map_parser.add_argument(
        "--mapping-config", required=True, help="Path to the YAML file defining the column mappings."
    )
    map_parser.set_defaults(func=handle_configure_mapping_command)

    # --- Upload Command ---
    upload_parser = subparsers.add_parser(
        "upload",
        help="Add files, prepare metadata, and create Zenodo drafts.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    upload_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    upload_parser.add_argument("--input-dir", required=True, help="Directory with input files.")
    upload_parser.add_argument(
        "--extensions",
        nargs="+",
        help="File extensions to filter by (e.g., .jpg .png).\nIf omitted, a default list of common types is used.",
    )
    upload_parser.add_argument(
        "--recursive", action="store_true", help="Scan for files in subdirectories of the input directory."
    )
    env_group_upload = upload_parser.add_mutually_exclusive_group()
    env_group_upload.add_argument(
        "--sandbox", action="store_true", default=True, help="Target the Zenodo Sandbox environment (default)."
    )
    env_group_upload.add_argument(
        "--production", action="store_false", dest="sandbox", help="Target the Zenodo Production environment."
    )
    upload_parser.set_defaults(func=handle_upload_command)

    # --- Process Command ---
    process_parser = subparsers.add_parser(
        "process", help="Run a pipeline on existing Zenodo drafts.", formatter_class=argparse.RawTextHelpFormatter
    )
    process_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    process_parser.add_argument("--pipeline", required=True, help="Name (identifier) of the pipeline to execute.")
    env_group_proc = process_parser.add_mutually_exclusive_group()
    env_group_proc.add_argument(
        "--sandbox",
        action="store_true",
        default=True,
        help="Target drafts in the Zenodo Sandbox environment (default).",
    )
    env_group_proc.add_argument(
        "--production",
        action="store_false",
        dest="sandbox",
        help="Target drafts in the Zenodo Production environment.",
    )
    filter_group = process_parser.add_argument_group(
        "Filtering Options", "Specify criteria to select which drafts to process."
    )
    filter_group.add_argument("--search", help="A general search term to filter records by title or filename.")
    filter_group.add_argument("--title-pattern", help="A pattern to match record titles (use '*' as a wildcard).")
    filter_group.add_argument("--since", help="Filter for records created on or after this date (YYYY-MM-DD).")
    filter_group.add_argument("--until", help="Filter for records created on or before this date (YYYY-MM-DD).")
    process_parser.set_defaults(func=handle_process_command)

    # --- Publish Command ---
    publish_parser = subparsers.add_parser(
        "publish", help="Publish ready Zenodo drafts.", formatter_class=argparse.RawTextHelpFormatter
    )
    selection_group = publish_parser.add_mutually_exclusive_group(required=True)
    selection_group.add_argument(
        "--all", action="store_true", help="Publish ALL drafts that are ready (all files uploaded)."
    )
    selection_group.add_argument(
        "--record-ids",
        type=int,
        nargs="+",
        help="A space-separated list of specific local record database IDs to publish.",
    )
    publish_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    env_group_pub = publish_parser.add_mutually_exclusive_group()
    env_group_pub.add_argument(
        "--sandbox",
        action="store_true",
        default=True,
        help="Target drafts in the Zenodo Sandbox environment (default).",
    )
    env_group_pub.add_argument(
        "--production",
        action="store_false",
        dest="sandbox",
        help="Target drafts in the Zenodo Production environment.",
    )
    publish_parser.set_defaults(func=handle_publish_command)

    # --- Create Version Command ---
    version_parser = subparsers.add_parser(
        "create-version", help="Create a new version of existing records from a directory of updated files."
    )
    version_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    version_parser.add_argument(
        "--input-dir", required=True, help="Directory containing the new or updated source files."
    )
    version_parser.add_argument(
        "--pipeline", required=True, help="Name of the pipeline to execute for creating the new version."
    )
    version_parser.add_argument(
        "--match-method",
        default="filename",
        choices=["filename", "hashcode"],
        help="Method to match new files with existing published records.",
    )
    env_group_ver = version_parser.add_mutually_exclusive_group()
    env_group_ver.add_argument(
        "--sandbox",
        action="store_true",
        default=True,
        help="Target records in the Zenodo Sandbox environment (default).",
    )
    env_group_ver.add_argument(
        "--production",
        action="store_false",
        dest="sandbox",
        help="Target records in the Zenodo Production environment.",
    )
    version_parser.set_defaults(func=handle_create_version_command)

    # --- Discard Drafts Command ---
    discard_parser = subparsers.add_parser("discard-drafts", help="Discard existing Zenodo drafts.")
    discard_selection_group = discard_parser.add_mutually_exclusive_group(required=True)
    discard_selection_group.add_argument(
        "--all", action="store_true", help="Discard ALL drafts in the specified environment."
    )
    discard_selection_group.add_argument(
        "--record-ids", type=int, nargs="+", help="A space-separated list of specific draft IDs to discard."
    )
    discard_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    env_group_discard = discard_parser.add_mutually_exclusive_group()
    env_group_discard.add_argument(
        "--sandbox", action="store_true", default=True, help="Target Sandbox environment (default)."
    )
    env_group_discard.add_argument(
        "--production", action="store_false", dest="sandbox", help="Target Production environment."
    )
    discard_parser.set_defaults(func=handle_discard_drafts_command)

    # --- Run Pipeline Command ---
    run_parser = subparsers.add_parser(
        "run-pipeline", help="Run a complete end-to-end pipeline on a directory of local files."
    )
    run_parser.add_argument("--hdpc", required=True, help="Path to the project's .hdpc file.")
    run_parser.add_argument("--pipeline", required=True, help="Name (identifier) of the pipeline to execute.")
    run_parser.add_argument("--input-dir", required=True, help="Directory containing the input files to process.")
    run_parser.add_argument("--extensions", nargs="+", help="File extensions to filter by (e.g., .jpg .png).")
    run_parser.add_argument("--recursive", action="store_true", help="Scan for files in subdirectories.")
    env_group_run = run_parser.add_mutually_exclusive_group()
    env_group_run.add_argument(
        "--sandbox", action="store_true", default=True, help="Execute pipeline in the Sandbox environment (default)."
    )
    env_group_run.add_argument(
        "--production", action="store_false", dest="sandbox", help="Execute pipeline in the Production environment."
    )
    run_parser.set_defaults(func=handle_run_pipeline_command)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
