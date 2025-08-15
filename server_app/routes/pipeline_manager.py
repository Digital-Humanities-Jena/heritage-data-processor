# server_app/routes/pipeline_manager.py
import logging
import json
from pathlib import Path
import requests
import time
from datetime import datetime, timezone
import re
import sqlite3

from flask import Blueprint, current_app, jsonify, make_response, request

from ..legacy.pipeline_database import PipelineDatabaseManager
from .component_runner import run_component
from .project import add_source_files_route
from ..services.project_manager import project_manager
from ..services.database import query_db, get_db_connection
from ..services.zenodo_api_service import get_api_params, get_base_url
from ..utils.decorators import project_required
from ..utils.file_helpers import calculate_file_hash, get_file_mime_type
from .zenodo import (
    create_api_draft_for_prepared_record,
    create_new_version_draft,
    prepare_metadata_for_file_route,
    publish_record,
    upload_files_for_deposition_route,
)

pipeline_manager_bp = Blueprint("pipeline_manager_bp", __name__)
logger = logging.getLogger(__name__)

# In a production app, the database path will come from the app config.
PIPELINE_DB_PATH = Path("databases") / "pipeline_system.db"
pipeline_db = PipelineDatabaseManager(PIPELINE_DB_PATH)


def _construct_description(
    template: str, execution_file_map: dict, record_id: int, current_metadata: dict = None
) -> str:
    """
    Constructs a description by replacing placeholders with values from output files
    and the Zenodo record's metadata.
    """
    if not template:
        return ""

    logger.info("Constructing description from template.")
    description = template

    # Use the provided metadata if available, otherwise lazy-load it.
    zenodo_metadata = current_metadata

    placeholders = re.findall(r"\$\{(.+?)\}", template)

    for placeholder in placeholders:
        if placeholder.startswith("zenodo_metadata."):
            # Load metadata only if it wasn't passed in and is needed
            if zenodo_metadata is None:
                try:
                    record_data = query_db(
                        project_manager.db_path,
                        "SELECT record_metadata_json FROM zenodo_records WHERE record_id = ?",
                        (record_id,),
                    )
                    if record_data and record_data[0]["record_metadata_json"]:
                        zenodo_metadata = json.loads(record_data[0]["record_metadata_json"])
                    else:
                        logger.warning(f"Could not load Zenodo metadata for record_id {record_id}.")
                        zenodo_metadata = {}
                except Exception as e:
                    logger.error(f"Error loading Zenodo metadata for record_id {record_id}: {e}")
                    zenodo_metadata = {}

            key_path = placeholder.split(".", 1)[1]
            value = _get_nested_value(zenodo_metadata, key_path)
            if value is not None:
                description = description.replace(f"${{{placeholder}}}", str(value))
                logger.info(f"Replaced Zenodo placeholder {placeholder} with value: {str(value)[:50]}...")
            else:
                logger.warning(f"Zenodo key path '{key_path}' not found for record_id {record_id}.")
            continue

        parts = placeholder.split(".", 1)
        file_id = parts[0]
        key_path = parts[1] if len(parts) > 1 else None

        if file_id in execution_file_map:
            file_path_str = execution_file_map[file_id]
            file_path = Path(file_path_str)

            if not file_path.exists():
                logger.warning(f"Output file for placeholder not found: {file_path_str}")
                continue

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    if key_path:
                        if file_path.suffix.lower() == ".json":
                            data = json.load(f)
                            value = _get_nested_value(data, key_path)
                            if value is not None:
                                description = description.replace(f"${{{placeholder}}}", str(value))
                                logger.info(f"Replaced {placeholder} with value: {str(value)[:50]}...")
                            else:
                                logger.warning(f"Key path '{key_path}' not found in JSON file '{file_path.name}'.")
                        else:
                            logger.warning(
                                f"Cannot get nested key '{key_path}' from non-JSON file '{file_path.name}'."
                            )
                    else:
                        value = f.read()
                        description = description.replace(f"${{{placeholder}}}", value)
                        logger.info(f"Replaced {placeholder} with entire content of {file_path.name}.")

            except Exception as e:
                logger.error(f"Error processing placeholder '{placeholder}' for file {file_path.name}: {e}")
        else:
            logger.warning(
                f"Could not resolve placeholder: {placeholder}. File ID '{file_id}' not found in execution map."
            )

    return description


def _update_draft_metadata(record_id: int, overrides: dict) -> bool:
    """
    Safely updates the Zenodo draft metadata via the API and then updates the
    locally stored record with the confirmed response from Zenodo.
    """
    logger.info(f"Updating Zenodo draft and local record for DB ID {record_id} with pipeline overrides.")
    logger.debug(f"Overrides for record {record_id}: {overrides}")
    try:
        # Connect to the project DB to get current draft details
        with sqlite3.connect(project_manager.db_path) as conn:
            conn.row_factory = sqlite3.Row
            record = conn.execute(
                "SELECT record_metadata_json, is_sandbox FROM zenodo_records WHERE record_id = ?", (record_id,)
            ).fetchone()

            if not record or not record["record_metadata_json"]:
                logger.error(f"Could not find local record or its metadata for ID {record_id} for API update.")
                return False

            payload = json.loads(record["record_metadata_json"])
            is_sandbox = bool(record["is_sandbox"])

            update_url = payload.get("links", {}).get("self")

            if not update_url:
                logger.error(f"No 'self' link found in metadata for record {record_id}. Cannot update draft.")
                return False

            # Apply the overrides to the metadata part of the payload
            metadata = payload.get("metadata", {})
            metadata.update(overrides)

            # The API expects a root object with a 'metadata' key
            update_payload = {"metadata": metadata}
            logger.debug(f"Update payload for Zenodo API: {json.dumps(update_payload, indent=2)}")

            # Get API credentials
            api_params = get_api_params(is_sandbox)

            # Make the API call to update the draft on Zenodo
            logger.info(f"Sending PUT request to Zenodo draft URL: {update_url}")
            response = requests.put(update_url, json=update_payload, params=api_params, timeout=60)

            if not response.ok:
                logger.error(
                    f"Failed to update Zenodo draft for record {record_id}. Status: {response.status_code}, Response: {response.text}"
                )
                return False

            logger.info(f"Successfully updated Zenodo draft {payload.get('id')} via API.")

            updated_payload_from_zenodo = response.json()
            new_title = updated_payload_from_zenodo.get("metadata", {}).get("title", "Untitled Record")
            new_version = updated_payload_from_zenodo.get("metadata", {}).get("version", "0.0.0")

            conn.execute(
                """
                UPDATE zenodo_records
                SET record_metadata_json = ?, record_title = ?, version = ?
                WHERE record_id = ?
                """,
                (json.dumps(updated_payload_from_zenodo), new_title, new_version, record_id),
            )
            conn.commit()
            logger.info(f"Successfully synced local record {record_id} with updated Zenodo draft metadata.")
            return True

    except Exception as e:
        logger.error(f"Failed during Zenodo draft API update for record_id {record_id}: {e}", exc_info=True)
        return False


def _cleanup_old_derived_files(record_id: int):
    """
    Deletes all derived files (and their map entries) associated with a
    record to ensure a clean slate before a new pipeline run.
    """
    logger.info(f"Cleaning up old derived files for record_id {record_id} before pipeline execution.")
    try:
        with sqlite3.connect(project_manager.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            source_file_id_row = cursor.execute(
                "SELECT source_file_id FROM zenodo_records WHERE record_id = ?", (record_id,)
            ).fetchone()

            if not source_file_id_row:
                logger.warning(f"Could not find source file for record {record_id}. Skipping cleanup.")
                return

            source_file_id_to_keep = source_file_id_row["source_file_id"]

            derived_files_to_delete = cursor.execute(
                "SELECT file_id FROM record_files_map WHERE record_id = ? AND file_id != ?",
                (record_id, source_file_id_to_keep),
            ).fetchall()

            if derived_files_to_delete:
                file_ids_to_delete = [row["file_id"] for row in derived_files_to_delete]

                placeholders = ",".join("?" for _ in file_ids_to_delete)

                cursor.execute(f"DELETE FROM record_files_map WHERE file_id IN ({placeholders})", file_ids_to_delete)
                cursor.execute(f"DELETE FROM source_files WHERE file_id IN ({placeholders})", file_ids_to_delete)

                conn.commit()
                logger.info(f"Successfully cleaned up {len(file_ids_to_delete)} old derived files.")
            else:
                logger.info("No old derived files found to clean up.")

    except Exception as e:
        logger.error(f"Failed to clean up old derived files for record_id {record_id}: {e}", exc_info=True)


def _backup_record_metadata(record_id: int):
    """
    Backs up the current metadata for a record before pipeline execution.
    """
    logger.info(f"Backing up metadata for record_id {record_id} before pipeline execution.")
    try:
        with sqlite3.connect(project_manager.db_path) as conn:
            conn.row_factory = sqlite3.Row

            current_record_state = conn.execute(
                "SELECT record_metadata_json FROM zenodo_records WHERE record_id = ?", (record_id,)
            ).fetchone()

            if current_record_state and current_record_state["record_metadata_json"]:
                # Clear any old backups for this record to ensure only the latest is kept.
                conn.execute("DELETE FROM metadata_backups WHERE record_id = ?", (record_id,))

                # Insert the new backup. Note we are no longer storing the mapping_config.
                conn.execute(
                    """
                    INSERT INTO metadata_backups (record_id, backup_timestamp, record_metadata_json, mapping_config)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        record_id,
                        datetime.now(timezone.utc).isoformat(),
                        current_record_state["record_metadata_json"],
                        "{}",  # Store an empty JSON object as a placeholder
                    ),
                )
                conn.commit()
                logger.info(f"Successfully created metadata backup for record_id {record_id}.")
            else:
                logger.warning(f"Could not find existing metadata for record_id {record_id}. Skipping backup.")
    except Exception as e:
        logger.error(f"Failed to backup metadata for record_id {record_id}: {e}", exc_info=True)
        # Here it proceeds even if backup fails to not block the main workflow


@pipeline_manager_bp.route("/pipelines", methods=["GET"])
def get_pipelines():
    """Get all pipelines with optional filtering by status."""
    try:
        status = request.args.get("status")
        # Get the summary list to find all pipeline identifiers
        pipeline_summaries = pipeline_db.list_pipelines(status=status)

        # Fetch the full, detailed data for each pipeline
        full_pipelines = []
        for summary in pipeline_summaries:
            full_pipeline_data = pipeline_db.get_pipeline(summary["identifier"])
            if full_pipeline_data:
                full_pipelines.append(full_pipeline_data)

        return jsonify(full_pipelines)
    except Exception as e:
        logger.error(f"Error in GET /pipelines: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines", methods=["POST"])
def create_pipeline():
    """Create a new pipeline from JSON data."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        pipeline_id = pipeline_db.create_pipeline(data)
        return jsonify({"success": True, "pipeline_id": pipeline_id}), 201
    except Exception as e:
        logger.error(f"Error in POST /pipelines: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/<identifier>", methods=["GET"])
def get_pipeline(identifier):
    """Get a specific pipeline by its identifier."""
    try:
        pipeline = pipeline_db.get_pipeline(identifier)
        if pipeline:
            return jsonify(pipeline)
        return jsonify({"error": "Pipeline not found"}), 404
    except Exception as e:
        logger.error(f"Error in GET /pipelines/{identifier}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/<identifier>", methods=["PUT"])
def update_pipeline(identifier):
    """Update an existing pipeline's complete definition."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Optional: Validate that the identifier in URL matches data
        if data.get("identifier") and data.get("identifier") != identifier:
            return jsonify({"error": "Identifier in URL and payload do not match"}), 400

        success = pipeline_db.update_pipeline_complete(identifier, data)
        if success:
            return jsonify({"success": True, "message": "Pipeline updated successfully"})
        else:
            return jsonify({"error": "Pipeline not found or update failed"}), 404
    except Exception as e:
        logger.error(f"Error in PUT /pipelines/{identifier}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/<identifier>", methods=["DELETE"])
def delete_pipeline(identifier):
    """Delete a pipeline."""
    try:
        success = pipeline_db.delete_pipeline(identifier)
        if success:
            return jsonify({"success": True, "message": "Pipeline deleted successfully"})
        return jsonify({"error": "Pipeline not found"}), 404
    except Exception as e:
        logger.error(f"Error in DELETE /pipelines/{identifier}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/import", methods=["POST"])
def import_pipeline_yaml():
    """Import a pipeline from an uploaded YAML file."""
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file part in the request"}), 400
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No file selected for uploading"}), 400

        yaml_content = file.read().decode("utf-8")
        pipeline_id = pipeline_db.import_from_yaml(yaml_content)
        return jsonify({"success": True, "pipeline_id": pipeline_id})
    except Exception as e:
        logger.error(f"Error in POST /pipelines/import: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/<identifier>/export", methods=["GET"])
def export_pipeline_yaml(identifier):
    """Export a specific pipeline to a downloadable YAML file."""
    try:
        yaml_content = pipeline_db.export_to_yaml(identifier)
        if yaml_content:
            response = make_response(yaml_content)
            response.headers["Content-Type"] = "application/x-yaml"
            response.headers["Content-Disposition"] = f"attachment; filename={identifier}.yaml"
            return response
        return jsonify({"error": "Pipeline not found"}), 404
    except Exception as e:
        logger.error(f"Error in GET /pipelines/{identifier}/export: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


def _get_nested_value(data: dict, key_path: str):
    """Safely retrieves a value from a nested dictionary."""
    keys = key_path.split(".")
    value = data
    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return None
    return value


def _collect_overrides_from_pipeline_outputs(pipeline: dict, execution_file_map: dict) -> dict:
    """
    Reads pipeline output files to collect metadata overrides.
    This version uses the execution_file_map to get the actual paths of the
    output files, making it robust against incorrect filename patterns.
    """
    overrides = {}
    logger.info("Collecting metadata overrides from pipeline outputs using execution_file_map.")
    logger.debug(f"Execution file map: {execution_file_map}")

    # The execution_file_map contains the ground truth: { 'output_id': '/path/to/actual_file.json', ... }

    for step in pipeline.get("steps", []):
        for output_config in step.get("outputs", []):
            mapping = output_config.get("outputMapping", {})
            if not mapping.get("mapToZenodo"):
                continue

            # Get the internal ID for this output file (e.g., 'file_4')
            output_id = output_config.get("id")
            if not output_id:
                logger.warning("Skipping output with no ID in pipeline definition.")
                continue

            # Find the actual path of the created file from the execution map
            output_file_path_str = execution_file_map.get(output_id)
            if not output_file_path_str:
                logger.warning(f"Could not find path for output ID '{output_id}' in execution_file_map. Skipping.")
                continue

            output_file_path = Path(output_file_path_str)
            logger.info(f"Checking for output file to source overrides: {output_file_path}")

            if output_file_path.exists():
                try:
                    with open(output_file_path, "r", encoding="utf-8") as f:
                        output_data = json.load(f)
                        logger.debug(f"Loaded data from {output_file_path.name}")

                    for rule in mapping.get("zenodoMappings", []):
                        zenodo_field = rule.get("zenodoField")
                        json_key = rule.get("jsonKey")
                        if zenodo_field and json_key:
                            value = _get_nested_value(output_data, json_key)
                            if value is not None:
                                overrides[zenodo_field] = value
                                logger.info(f"✅ OVERRIDE FOUND for '{zenodo_field}': '{str(value)[:100]}...'")
                            else:
                                logger.warning(f"JSON key '{json_key}' not found in {output_file_path}")
                except Exception as e:
                    logger.error(f"Failed to read or parse override from {output_file_path}: {e}")
            else:
                logger.warning(f"File path from execution_file_map not found on disk: {output_file_path}")

    return overrides


@pipeline_manager_bp.route("/pipelines/<identifier>/execute_on_local_files", methods=["POST"])
@project_required
def execute_pipeline_on_local_files(identifier):
    """
    New entry point for the 'run-pipeline' CLI command. It takes local file paths,
    creates the necessary database records, and then hands them off to the main pipeline executor.
    """
    data = request.get_json()
    local_file_paths = data.get("local_file_paths", [])
    is_sandbox = data.get("is_sandbox", True)

    if not local_file_paths:
        return jsonify({"success": False, "error": "No local_file_paths provided."}), 400

    conn = get_db_connection(project_manager.db_path)
    try:
        project_id = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")[0]["project_id"]

        file_ids_to_process = []
        with conn:
            cursor = conn.cursor()
            for path_str in local_file_paths:
                file_path = Path(path_str)
                existing = cursor.execute(
                    "SELECT file_id FROM source_files WHERE absolute_path = ?", (str(file_path),)
                ).fetchone()
                if existing:
                    # If the file already exists, we still want to process it in this run.
                    file_ids_to_process.append(existing[0])
                    continue

                cursor.execute(
                    """
                    INSERT INTO source_files (project_id, absolute_path, relative_path, filename, size_bytes, sha256_hash, mime_type, file_type, status, added_timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        str(file_path.resolve()),
                        file_path.name,
                        file_path.name,
                        file_path.stat().st_size,
                        calculate_file_hash(file_path),
                        get_file_mime_type(file_path),
                        "source",
                        "pending",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                file_ids_to_process.append(cursor.lastrowid)

        prepared_record_ids = []
        for file_id in file_ids_to_process:
            with current_app.test_request_context(
                json={"source_file_db_id": file_id, "target_is_sandbox": is_sandbox}
            ):
                response = prepare_metadata_for_file_route()
                response_obj = response[0] if isinstance(response, tuple) else response
                response_data = response_obj.get_json()

                if not response_data.get("success"):
                    raise Exception(f"Metadata preparation failed for file_id {file_id}: {response_data.get('error')}")

                # After preparation, a record is created. We need its ID for the pipeline.
                record_id_row = query_db(
                    project_manager.db_path,
                    "SELECT record_id FROM zenodo_records WHERE source_file_id = ?",
                    (file_id,),
                )
                if record_id_row:
                    prepared_record_ids.append(record_id_row[0]["record_id"])

        if not prepared_record_ids:
            return jsonify({"success": False, "error": "Could not prepare any records for the pipeline."}), 500

        with current_app.test_request_context(json={"record_ids": prepared_record_ids, "is_sandbox": is_sandbox}):
            return execute_pipeline(identifier)

    except Exception as e:
        logger.error(f"Error in execute_on_local_files for pipeline {identifier}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@pipeline_manager_bp.route("/pipelines/<identifier>/execute", methods=["POST"])
def execute_pipeline(identifier):
    """
    Executes a multi-step pipeline synchronously, using direct function calls
    instead of internal HTTP requests. Handles both initial creation and new version creation.
    """
    data = request.get_json()
    record_ids = data.get("record_ids", [])
    concept_rec_id = data.get("concept_rec_id")
    file_manifest = data.get("file_manifest")
    is_sandbox = data.get("is_sandbox", True)
    is_versioning_mode = bool(concept_rec_id)

    if not record_ids and not is_versioning_mode:
        return jsonify({"success": False, "error": "No record_ids or concept_rec_id provided"}), 400

    try:
        pipeline = pipeline_db.get_pipeline(identifier)
        if not pipeline:
            return jsonify({"success": False, "error": "Pipeline not found"}), 404

        create_draft_enabled = pipeline.get("zenodoDraftStepEnabled", False)
        upload_files_enabled = pipeline.get("zenodoUploadStepEnabled", False)
        publish_enabled = pipeline.get("zenodoPublishStepEnabled", False)

        processed_count = 0
        errors = []
        items_to_process = [concept_rec_id] if is_versioning_mode else record_ids

        for item_id in items_to_process:
            logger.info(f"--- Starting pipeline execution for item: {item_id} ---")
            execution_file_map = {}
            unique_output_dir = None
            current_record_id = None
            zenodo_draft_data = None

            try:
                # --- STEP 1: Create Draft or New Version ---
                if is_versioning_mode:
                    logger.info(f"Running in versioning mode for concept_rec_id: {item_id}")
                    version_result = create_new_version_draft(item_id, is_sandbox)
                    if not version_result.get("success"):
                        raise Exception(f"Failed to create new version draft: {version_result.get('error')}")
                    current_record_id = version_result["new_local_record_id"]
                    zenodo_draft_data = version_result.get("zenodo_response", {})
                    logger.info(
                        f"New version draft created. Local DB record ID: {current_record_id}, Zenodo ID: {zenodo_draft_data.get('id')}"
                    )
                    if file_manifest:
                        logger.info("File manifest provided, syncing files.")
                        _sync_file_manifest(zenodo_draft_data, file_manifest, is_sandbox, current_record_id)
                else:
                    current_record_id = item_id
                    logger.info(f"Running in standard mode for local record ID: {current_record_id}")
                    _backup_record_metadata(current_record_id)
                    if create_draft_enabled:
                        logger.info("Draft creation step is enabled.")
                        with current_app.test_request_context(json={"local_record_db_id": current_record_id}):
                            response_obj, _ = create_api_draft_for_prepared_record()
                            draft_result = response_obj.get_json()
                            if not draft_result.get("success"):
                                raise Exception(f"Draft creation failed: {draft_result.get('error')}")
                            zenodo_draft_data = draft_result.get("zenodo_response", {})
                            logger.info(f"Zenodo draft created successfully. Zenodo ID: {zenodo_draft_data.get('id')}")
                    else:
                        logger.info("Draft creation step is disabled.")

                # --- Setup output directory ---
                record_info = query_db(
                    project_manager.db_path,
                    "SELECT sf.absolute_path FROM zenodo_records zr JOIN source_files sf ON zr.source_file_id = sf.file_id WHERE zr.record_id = ?",
                    (current_record_id,),
                )[0]
                execution_file_map["source_file"] = record_info["absolute_path"]
                base_output_dir = Path(record_info["absolute_path"]).parent
                if zenodo_draft_data:
                    unique_output_dir = (
                        base_output_dir / str(zenodo_draft_data.get("conceptrecid")) / str(zenodo_draft_data.get("id"))
                    )
                else:
                    unique_output_dir = base_output_dir / f"record_{current_record_id}_output_{int(time.time())}"

                logger.info(f"Using output directory: {unique_output_dir}")

                # --- STEP 2: Execute Pipeline Components ---
                for step in pipeline.get("steps", []):
                    component_name = step.get("component_name")
                    if not component_name:
                        continue

                    logger.info(f"  - STEP {step['step_number']}: Running component '{component_name}'")
                    step_inputs = resolve_step_inputs(step.get("inputMapping", {}), execution_file_map)
                    logger.debug(f"Resolved step inputs: {step_inputs}")
                    unique_output_dir.mkdir(parents=True, exist_ok=True)
                    run_payload = {
                        "inputs": step_inputs,
                        "parameters": step.get("parameters", {}),
                        "output_directory": str(unique_output_dir),
                    }
                    logger.debug(f"Component run payload: {run_payload}")

                    # --- Direct internal call to run_component ---
                    with current_app.test_request_context(json=run_payload):
                        response_tuple = run_component(component_name)
                        start_result = response_tuple[0].get_json()
                        if response_tuple[1] != 202:
                            raise Exception(f"Failed to start component {component_name}: {start_result.get('error')}")
                        execution_id = start_result["execution_id"]
                        logger.info(f"Component execution started with ID: {execution_id}")

                    # --- Synchronous Polling Loop ---
                    output_files = []
                    timeout = step.get("timeout_seconds", 300)
                    start_time = time.time()
                    while time.time() - start_time < timeout:
                        # --- Use current_app.config to reliably get the server port ---
                        server_port = current_app.config.get("SERVER_PORT", 5001)
                        status_url = f"http://localhost:{server_port}/api/components/executions/{execution_id}/status"
                        logger.debug(f"Polling component status from: {status_url}")
                        status_resp = requests.get(status_url)

                        if status_resp.ok:
                            status_data = status_resp.json()
                            logger.debug(f"Component status: {status_data.get('status')}")
                            if status_data.get("status") == "completed":
                                output_files = status_data.get("results", {}).get("output_files", [])
                                logger.info(f"Component '{component_name}' completed successfully.")
                                break
                            elif status_data.get("status") == "failed":
                                raise Exception(f"Component '{component_name}' execution failed.")
                        time.sleep(2)
                    else:
                        raise Exception(f"Component '{component_name}' timed out after {timeout} seconds.")

                    # --- Direct internal call to add output files ---
                    for i, output_file_path in enumerate(output_files):
                        output_file_id = step["outputs"][i]["id"]
                        execution_file_map[output_file_id] = output_file_path
                        logger.info(f"Mapping output ID '{output_file_id}' to path: {output_file_path}")
                        add_payload = {
                            "absolute_file_paths": [output_file_path],
                            "record_id_to_associate": current_record_id,
                            "pipeline_name": pipeline["name"],
                            "step_name": step["step_name"],
                        }
                        logger.debug(f"Adding derived file to project with payload: {add_payload}")
                        with current_app.test_request_context(json=add_payload):
                            response = add_source_files_route()
                            response_obj = response[0] if isinstance(response, tuple) else response
                            if response_obj.status_code != 200:
                                raise Exception(f"Failed to add output file '{output_file_path}' to project.")
                            logger.info(f"Successfully added derived file '{output_file_path}' to project.")

                # --- STEP 3: Metadata Overrides & STEP 4: UPLOAD & STEP 5: PUBLISH ---

                overrides = _collect_overrides_from_pipeline_outputs(pipeline, execution_file_map)
                if overrides:
                    logger.info(f"Found {len(overrides)} metadata overrides from pipeline outputs.")
                    logger.debug(f"Overrides: {overrides}")
                    if create_draft_enabled or is_versioning_mode:
                        _update_draft_metadata(current_record_id, overrides)
                    else:
                        logger.info("Re-preparing metadata with overrides for non-draft workflow.")
                        # --- Direct internal call to re-prepare metadata ---
                        re_prepare_payload = {
                            "source_file_db_id": record_info["source_file_id"],
                            "overrides": overrides,
                        }
                        with current_app.test_request_context(json=re_prepare_payload):
                            response = prepare_metadata_for_file_route()
                            response_obj = response[0] if isinstance(response, tuple) else response
                            if response_obj.status_code != 200:
                                raise Exception("Metadata re-preparation failed after pipeline run.")
                            logger.info("Metadata re-prepared successfully with overrides.")

                if upload_files_enabled:
                    logger.info(f"Uploading files for record {current_record_id}...")
                    with current_app.test_request_context(json={"local_record_db_id": current_record_id}):
                        response_obj = upload_files_for_deposition_route()
                        upload_result = response_obj.get_json()
                        if not upload_result.get("success"):
                            raise Exception(f"File upload failed: {upload_result.get('message')}")
                        logger.info("File upload step completed successfully.")

                if publish_enabled:
                    logger.info(f"Publishing record {current_record_id}...")
                    with get_db_connection(project_manager.db_path) as conn:
                        record_row = conn.execute(
                            "SELECT * FROM zenodo_records WHERE record_id = ?", (current_record_id,)
                        ).fetchone()
                        msg_dict, _ = publish_record(
                            record_row, conn, get_api_params(is_sandbox), get_base_url(is_sandbox)
                        )
                        if not msg_dict.get("success"):
                            raise Exception(f"Publishing failed: {msg_dict.get('text')}")
                        logger.info("Record published successfully.")

                processed_count += 1
                logger.info(f"--- Successfully finished pipeline execution for item: {item_id} ---")
            except Exception as e:
                logger.error(f"Failed to process item {item_id}: {e}", exc_info=True)
                errors.append(f"Item {item_id}: {str(e)}")

        if errors:
            logger.error(f"Pipeline finished with errors: {errors}")
            return (
                jsonify({"success": False, "message": "Pipeline finished with errors.", "error": "\n".join(errors)}),
                207,
            )
        else:
            logger.info("Pipeline execution completed for all items without errors.")
            return jsonify(
                {"success": True, "message": f"Successfully executed pipeline for {processed_count} items."}
            )

    except Exception as e:
        logger.error(f"Error in POST /pipelines/{identifier}/execute: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@pipeline_manager_bp.route("/executions/<execution_uuid>/status", methods=["GET"])
def get_execution_status(execution_uuid):
    """Get the status of a specific pipeline execution."""
    try:
        status = pipeline_db.get_execution_status(execution_uuid)
        if status:
            return jsonify(status)
        return jsonify({"error": "Execution not found"}), 404
    except Exception as e:
        logger.error(f"Error in GET /executions/{execution_uuid}/status: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@pipeline_manager_bp.route("/pipelines/<identifier>/metadata_mapping", methods=["PUT"])
def update_pipeline_metadata_mapping_route(identifier):
    """Saves or updates the Zenodo metadata mapping configuration for a pipeline."""
    try:
        mapping_data = request.get_json()
        if not isinstance(mapping_data, dict):
            return jsonify({"success": False, "error": "Invalid mapping data format."}), 400

        success = pipeline_db.update_pipeline_metadata_mapping(identifier, mapping_data)

        if success:
            return jsonify({"success": True, "message": "Metadata mapping updated successfully."})
        else:
            return jsonify({"success": False, "error": "Pipeline not found or update failed."}), 404
    except Exception as e:
        logger.error(f"Error updating metadata mapping for pipeline {identifier}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


def resolve_step_inputs(step_input_mapping: dict, available_files: dict) -> dict:
    """
    Resolves the actual file paths for a step's inputs based on its mapping.

    Args:
        step_input_mapping: The input mapping dictionary for the current step.
        available_files: A dictionary tracking available files and their paths.
                         Example: {'source_file': '/path/to/image.jpg', 'output_1': '/path/to/meta.json'}

    Returns:
        A dictionary of resolved inputs for the component.
    """
    resolved_inputs = {}
    for component_input_name, mapping_info in step_input_mapping.items():
        source_type = mapping_info.get("sourceType")
        if source_type == "pipelineFile":
            file_id = mapping_info.get("fileId")
            if file_id in available_files:
                resolved_inputs[component_input_name] = available_files[file_id]
            else:
                raise Exception(
                    f"Could not resolve pipeline file with ID '{file_id}' for input '{component_input_name}'."
                )
        # TODO: Add logic for 'externalPath', 'literal', etc. if needed in the future
    return resolved_inputs


def _sync_file_manifest(new_draft_data: dict, file_manifest: dict, is_sandbox: bool, new_local_record_id: int):
    """
    Synchronizes files in a new Zenodo draft based on a user-provided manifest.
    It deletes unwanted files, uploads the new source file, and updates the local DB.
    """
    logger.info(f"Starting file manifest synchronization for new draft ID {new_draft_data.get('id')}")

    files_to_keep = set(file_manifest.get("files_to_keep", []))
    new_source_path_str = file_manifest.get("new_source_file_path")

    if not new_source_path_str:
        raise ValueError("File manifest is missing the new source file path.")

    new_source_path = Path(new_source_path_str)
    if not new_source_path.is_file():
        raise FileNotFoundError(f"New source file not found at: {new_source_path_str}")

    api_params = get_api_params(is_sandbox)
    bucket_url = new_draft_data.get("links", {}).get("bucket")
    if not bucket_url:
        raise ValueError("Bucket URL not found in new Zenodo draft data.")

    # 1. Delete files that were unchecked by the user
    for old_file in new_draft_data.get("files", []):
        if old_file.get("filename") not in files_to_keep:
            try:
                delete_url = old_file.get("links", {}).get("self")
                if delete_url:
                    logger.info(f"Deleting file from draft: {old_file.get('filename')}")
                    requests.delete(delete_url, params=api_params, timeout=60).raise_for_status()
            except Exception as e:
                logger.warning(f"Could not delete file '{old_file.get('filename')}': {e}. Continuing...")

    # 2. Upload the new source file
    logger.info(f"Uploading new source file to draft: {new_source_path.name}")
    with open(new_source_path, "rb") as fp:
        upload_response = requests.put(f"{bucket_url}/{new_source_path.name}", data=fp, params=api_params, timeout=300)
        upload_response.raise_for_status()

    # 3. Update the local database to reflect the new source file
    with get_db_connection(project_manager.db_path) as conn:
        project_id = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")[0]["project_id"]
        cursor = conn.cursor()

        # Add the new file to the source_files table
        cursor.execute(
            """
            INSERT INTO source_files (project_id, absolute_path, relative_path, filename, size_bytes, sha256_hash, mime_type, file_type, status, added_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                str(new_source_path.resolve()),
                new_source_path.name,
                new_source_path.name,
                new_source_path.stat().st_size,
                calculate_file_hash(new_source_path),
                get_file_mime_type(new_source_path),
                "source",
                "pending",  # It's pending until the record is published
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        new_source_file_id = cursor.lastrowid

        # Update the new zenodo_records entry to point to this new source file
        cursor.execute(
            "UPDATE zenodo_records SET source_file_id = ? WHERE record_id = ?",
            (new_source_file_id, new_local_record_id),
        )

        # Explicitly link the new source file in the record_files_map.
        # Mark it as 'uploaded' because the upload just happened successfully.
        cursor.execute(
            "INSERT OR IGNORE INTO record_files_map (record_id, file_id, upload_status) VALUES (?, ?, ?)",
            (new_local_record_id, new_source_file_id, "uploaded"),
        )

        conn.commit()

    logger.info(f"Successfully synced file manifest. New local source_file_id is {new_source_file_id}.")
    return new_source_file_id
