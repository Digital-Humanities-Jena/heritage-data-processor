# server_app/routes/zenodo.py
import json
import logging
import os
import sqlite3
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Tuple
import sys

import pandas as pd
import requests
from flask import Blueprint, current_app, jsonify, request

from ..legacy.metadata_processor import (
    prepare_zenodo_metadata,
    store_metadata_for_file,
    validate_zenodo_metadata,
)
from ..legacy.main_functions import create_record_cli, discard_draft_cli, rate_limiter_zenodo

from ..services.database import query_db, get_db_connection, execute_db, execute_db_transaction
from ..services.project_manager import project_manager
from ..services.zenodo_api_service import get_api_params, get_base_url

from ..utils.decorators import project_required
from ..utils.file_helpers import calculate_file_hash, get_file_mime_type

zenodo_bp = Blueprint("zenodo_bp", __name__)
logger = logging.getLogger(__name__)


# Helpers
PIPELINE_DB_PATH = Path("databases") / Path("pipeline_system.db")
PIPELINE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _restore_record_metadata(record_id: int):
    """
    Restores the most recent metadata backup for a given record, ensuring
    denormalized fields like title and version are also reverted.
    """
    logger.info(f"Attempting to restore metadata for record_id {record_id}.")
    try:
        with get_db_connection(project_manager.db_path) as conn:
            backup = conn.execute(
                "SELECT record_metadata_json FROM metadata_backups WHERE record_id = ? ORDER BY backup_timestamp DESC LIMIT 1",
                (record_id,),
            ).fetchone()

            if backup and backup["record_metadata_json"]:
                # Parse the backed-up JSON to extract denormalized fields
                try:
                    backed_up_data = json.loads(backup["record_metadata_json"])
                    metadata = backed_up_data.get("metadata", {})
                    restored_title = metadata.get("title", "Title not found in backup")
                    restored_version = metadata.get("version", "0.0.0")
                except (json.JSONDecodeError, AttributeError):
                    logger.error(f"Could not parse backed-up JSON for record_id {record_id}. Aborting restore.")
                    # Fallback to just resetting status without changing data
                    conn.execute(
                        "UPDATE zenodo_records SET record_status = 'prepared', last_api_error = NULL, zenodo_record_id = NULL, zenodo_doi = NULL WHERE record_id = ?",
                        (record_id,),
                    )
                    conn.commit()
                    return False

                # Restore the full JSON blob AND the denormalized columns
                conn.execute(
                    """
                    UPDATE zenodo_records 
                    SET record_metadata_json = ?, 
                        record_title = ?, 
                        version = ?,
                        record_status = 'prepared', 
                        last_api_error = NULL, 
                        zenodo_record_id = NULL, 
                        zenodo_doi = NULL 
                    WHERE record_id = ?
                    """,
                    (backup["record_metadata_json"], restored_title, restored_version, record_id),
                )

                conn.execute("DELETE FROM metadata_backups WHERE record_id = ?", (record_id,))

                conn.commit()
                logger.info(f"Successfully restored metadata, title, and version for record_id {record_id}.")
                return True
            else:
                logger.warning(f"No metadata backup found for record_id {record_id}. Resetting status only.")
                conn.execute(
                    "UPDATE zenodo_records SET record_status = 'prepared', last_api_error = NULL, zenodo_record_id = NULL, zenodo_doi = NULL WHERE record_id = ?",
                    (record_id,),
                )
                conn.commit()
                return False
    except Exception as e:
        logger.error(f"Failed to restore metadata for record_id {record_id}: {e}", exc_info=True)
        return False


def _apply_output_mappings(
    base_metadata: Dict[str, Any],
    source_file_id: int,
    pipeline_id: int,
) -> Tuple[Dict[str, Any], set]:
    """
    Applies Zenodo metadata mappings and returns the updated metadata
    along with a set of keys that were successfully overwritten.
    """
    logger.info(f"--- Applying output mappings for pipeline_id={pipeline_id}, source_file_id={source_file_id} ---")
    overwritten_keys = set()
    project_id = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")[0]["project_id"]

    execution = query_db(
        PIPELINE_DB_PATH,
        "SELECT pex.output_data_path FROM pipeline_executions pex WHERE pex.pipeline_id = ? AND pex.project_id = ? AND pex.status = 'completed' ORDER BY pex.end_timestamp DESC LIMIT 1;",
        (pipeline_id, project_id),
    )

    if not execution or not execution[0]["output_data_path"]:
        logger.warning(
            f"Could not find a completed execution with outputs for pipeline {pipeline_id} and project {project_id}."
        )
        return base_metadata, overwritten_keys

    output_dir = Path(execution[0]["output_data_path"])
    logger.info(f"Found execution output directory: {output_dir}")

    steps_with_mapping = query_db(
        PIPELINE_DB_PATH,
        "SELECT ps.step_id, sf.filename_pattern, sf.output_mapping FROM pipeline_steps ps JOIN step_files sf ON ps.step_id = sf.step_id WHERE ps.pipeline_id = ? AND sf.file_role = 'output' AND sf.output_mapping IS NOT NULL AND sf.output_mapping != '{}'",
        (pipeline_id,),
    )

    if not steps_with_mapping:
        return base_metadata, overwritten_keys

    source_file_info = query_db(
        project_manager.db_path, "SELECT filename FROM source_files WHERE file_id = ?", (source_file_id,)
    )
    if not source_file_info:
        return base_metadata, overwritten_keys
    original_stem = Path(source_file_info[0]["filename"]).stem

    for step in steps_with_mapping:
        try:
            output_mapping = json.loads(step["output_mapping"])
            if not output_mapping.get("mapToZenodo"):
                continue

            output_filename = step["filename_pattern"].replace("{original_stem}", original_stem)
            output_file_path = output_dir / output_filename

            if output_file_path.exists():
                with open(output_file_path, "r", encoding="utf-8") as f:
                    output_data = json.load(f)

                for rule in output_mapping.get("zenodoMappings", []):
                    zenodo_field = rule.get("zenodoField")
                    json_key_path = rule.get("jsonKey")

                    if zenodo_field and json_key_path:
                        value_to_map = _get_nested_value(output_data, json_key_path)
                        if value_to_map is not None:
                            base_metadata[zenodo_field] = value_to_map
                            overwritten_keys.add(zenodo_field)
                            logger.info(
                                f"✅ SUCCESS: Mapped Zenodo field '{zenodo_field}' to value '{value_to_map}' from JSON key path '{json_key_path}'."
                            )
                        else:
                            logger.warning(
                                f"⚠️  Skipping rule for '{zenodo_field}'. JSON key path '{json_key_path}' not found in output file."
                            )
            else:
                logger.warning(f"Output file for mapping not found: {output_file_path}")
        except Exception as e:
            logger.warning(f"Could not apply output mapping for step {step['step_id']}: {e}", exc_info=True)

    logger.info("--- Finished applying output mappings ---")
    return base_metadata, overwritten_keys


def _get_nested_value(data: Dict[str, Any], key_path: str) -> Optional[Any]:
    """
    Safely retrieves a value from a nested dictionary using a dot-separated key path.
    e.g., key_path 'results.output.description'
    """
    keys = key_path.split(".")
    value = data
    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return None
    return value


def _extract_and_prepare_metadata(conn: sqlite3.Connection, source_file_db_id: int) -> dict:
    """
    Faithfully adapted helper from the original working code.
    Loads mapping config, finds the matching row in a spreadsheet,
    and extracts all metadata fields.
    """
    cursor = conn.cursor()
    project_id = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]

    mapping_row = cursor.execute(
        "SELECT column_definitions, file_path FROM metadata_mapping_files WHERE project_id = ? ORDER BY last_used_timestamp DESC LIMIT 1",
        (project_id,),
    ).fetchone()

    if not mapping_row:
        raise ValueError("No active metadata mapping configured for this project.")

    mapping_config_full = json.loads(mapping_row["column_definitions"])
    mapping_mode = mapping_config_full.get("_mapping_mode", "file")

    file_info_row = cursor.execute(
        "SELECT * FROM source_files WHERE file_id = ? AND project_id = ?", (source_file_db_id, project_id)
    ).fetchone()
    if not file_info_row:
        raise FileNotFoundError(f"Source file ID {source_file_db_id} not found.")

    file_info_dict = dict(file_info_row)
    all_extracted_metadata = {}
    row_data_for_file = {}

    if mapping_mode == "file":
        spreadsheet_path_str = mapping_row["file_path"] or mapping_config_full.get("_file_path")

        if not spreadsheet_path_str or spreadsheet_path_str == "N/A":
            raise ValueError("Mapping mode is 'file' but no metadata file path is defined.")

        spreadsheet_path = Path(spreadsheet_path_str)
        if not spreadsheet_path.is_file():
            raise FileNotFoundError(f"Metadata spreadsheet not found: {spreadsheet_path}")

        df = (
            pd.read_excel(spreadsheet_path)
            if spreadsheet_path.suffix.lower() in [".xls", ".xlsx"]
            else pd.read_csv(spreadsheet_path)
        )
        filename_col_mapping = mapping_config_full.get("filename", {})
        filename_col = filename_col_mapping.get("value")

        if not filename_col or filename_col not in df.columns:
            raise ValueError(f"Filename column '{filename_col}' not found in spreadsheet.")

        matching_rows = df[df[filename_col] == file_info_dict["filename"]]
        if not matching_rows.empty:
            row_data_for_file = matching_rows.iloc[0].to_dict()

    for field, mapping in mapping_config_full.items():
        if field.startswith("_") or not isinstance(mapping, dict):
            continue
        map_type = mapping.get("type")
        map_value = mapping.get("value")

        if map_type == "literal":
            if map_value is not None and str(map_value).strip() != "":
                all_extracted_metadata[field] = map_value
        elif (
            map_type == "column"
            and mapping_mode == "file"
            and map_value in row_data_for_file
            and pd.notna(row_data_for_file[map_value])
        ):
            cell_value = row_data_for_file[map_value]
            if field == "keywords" and "delimiter" in mapping:
                all_extracted_metadata[field] = [
                    kw.strip() for kw in str(cell_value).split(mapping.get("delimiter", ",")) if kw.strip()
                ]
            else:
                all_extracted_metadata[field] = cell_value
        elif map_type == "ordered_combined_columns" and mapping_mode == "file" and isinstance(map_value, list):
            parts = [
                str(row_data_for_file[col]).strip()
                for col in map_value
                if col in row_data_for_file
                and pd.notna(row_data_for_file[col])
                and str(row_data_for_file[col]).strip()
            ]
            all_extracted_metadata[field] = mapping.get("delimiter", " ").join(parts)
        elif map_type in ("filename", "filename_stem"):
            subtype = mapping.get("subtype", "complete")
            if subtype == "stem":
                all_extracted_metadata[field] = Path(file_info_dict.get("filename", "")).stem
            else:
                all_extracted_metadata[field] = file_info_dict.get("filename")
        elif map_type == "constructed":
            all_extracted_metadata[field] = (
                str(map_value)
                .replace("{filename}", file_info_dict.get("filename", ""))
                .replace("{filename_stem}", Path(file_info_dict.get("filename", "")).stem)
            )
        elif map_type == "construct_later":
            all_extracted_metadata[field] = {"construct_later": True}
        elif map_type == "complex":
            all_extracted_metadata[field] = mapping

    return all_extracted_metadata, file_info_dict, mapping_config_full


# Metadata Mapping Routes


@zenodo_bp.route("/metadata/mapping_schema_details", methods=["GET"])
def get_metadata_mapping_schema_details():
    """Loads and returns the Zenodo mapping schema from an external JSON file."""
    try:
        schema_path = Path(__file__).parent.parent / "data" / "zenodo_mapping_schema.json"
        with open(schema_path, "r", encoding="utf-8") as f:
            schema_data = json.load(f)
        return jsonify(schema_data)
    except FileNotFoundError:
        return jsonify({"error": "Mapping schema file not found."}), 500
    except Exception as e:
        logger.error(f"Failed to load mapping schema: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load mapping schema: {e}"}), 500


@zenodo_bp.route("/project/metadata/save_mapping", methods=["POST"])
@project_required
def save_project_metadata_mapping():
    data = request.get_json()
    mapping_config = data.get("mappingConfiguration")

    try:
        project_info = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")
        if not project_info:
            return jsonify({"success": False, "error": "Project not found in database."}), 404
        project_id = project_info[0]["project_id"]

        metadata_file_path = mapping_config.get("_file_path", "N/A")
        mapping_name = f"mapping_for_{os.path.basename(metadata_file_path)}"

        existing_mapping = query_db(
            project_manager.db_path,
            "SELECT mapping_id FROM metadata_mapping_files WHERE project_id = ? LIMIT 1;",
            (project_id,),
        )

        commands = []

        if existing_mapping:
            existing_mapping_id = existing_mapping[0]["mapping_id"]
            # 1. Delete children first
            commands.append(("DELETE FROM metadata_values WHERE mapping_id = ?", (existing_mapping_id,)))
            # 2. Then delete the old parent
            commands.append(("DELETE FROM metadata_mapping_files WHERE project_id = ?", (project_id,)))

        # 3. Prepare to insert the new parent
        insert_sql = """
            INSERT INTO metadata_mapping_files (project_id, mapping_name, file_path, file_format, column_definitions)
            VALUES (?, ?, ?, ?, ?)
        """
        insert_params = (
            project_id,
            mapping_name,
            metadata_file_path,
            mapping_config.get("_file_format", "N/A"),
            json.dumps(mapping_config),
        )
        commands.append((insert_sql, insert_params))

        # Execute all commands together in one transaction
        success = execute_db_transaction(project_manager.db_path, commands)

        if success:
            return jsonify({"success": True, "message": "Metadata mapping saved successfully."})
        else:
            return jsonify({"success": False, "error": "Database error saving mapping."}), 500

    except Exception as e:
        logger.error(f"An unexpected error occurred in save_project_metadata_mapping: {e}")
        return jsonify({"success": False, "error": "An unexpected server error occurred."}), 500


@zenodo_bp.route("/mappings", methods=["GET"])
@project_required
def get_project_mappings():
    project_info = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")
    project_id = project_info[0]["project_id"]
    mappings = query_db(
        project_manager.db_path,
        "SELECT * FROM metadata_mapping_files WHERE project_id = ? ORDER BY last_used_timestamp DESC",
        (project_id,),
    )
    return jsonify(mappings if mappings else [])


# File and Record Preparation Routes
@zenodo_bp.route("/project/source_files/add", methods=["POST"])
@project_required
def add_source_files_route():
    data = request.get_json()
    file_paths = data.get("absolute_file_paths", [])
    if not file_paths:
        return jsonify({"error": "Missing 'absolute_file_paths' list."}), 400

    added_count, errors_count, skipped_count = 0, 0, 0
    errors_list = []

    project_info = query_db(project_manager.db_path, "SELECT project_id FROM project_info LIMIT 1;")
    project_id = project_info[0]["project_id"]

    conn = get_db_connection(project_manager.db_path)
    try:
        with conn:
            for path_str in file_paths:
                file_path = Path(path_str).resolve()
                if not file_path.is_file():
                    errors_list.append(f"Path is not a file: {path_str}")
                    errors_count += 1
                    continue

                # Check for existing path
                existing = conn.execute(
                    "SELECT file_id FROM source_files WHERE absolute_path = ?", (str(file_path),)
                ).fetchone()
                if existing:
                    skipped_count += 1
                    continue

                # Insert new file
                params = (
                    project_id,
                    str(file_path),
                    file_path.name,
                    file_path.name,
                    file_path.stat().st_size,
                    calculate_file_hash(file_path),
                    get_file_mime_type(file_path),
                    "source",
                    "pending",
                    datetime.now(timezone.utc).isoformat(),
                )
                conn.execute(
                    """
                    INSERT INTO source_files (project_id, absolute_path, relative_path, filename, size_bytes, sha256_hash, mime_type, file_type, status, added_timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    params,
                )
                added_count += 1
    except Exception as e:
        logger.error(f"Error adding source files: {e}", exc_info=True)
        return jsonify({"error": f"Internal server error: {e}"}), 500
    finally:
        if conn:
            conn.close()

    return (
        jsonify(
            {
                "message": "File addition process completed.",
                "added_count": added_count,
                "skipped_existing_path": skipped_count,
                "errors_count": errors_count,
                "errors": errors_list,
            }
        ),
        200,
    )


@zenodo_bp.route("/project/prepare_metadata_for_file", methods=["POST"])
@project_required
def prepare_metadata_for_file_route():
    data = request.get_json()
    source_file_db_id = data.get("source_file_db_id")
    target_is_sandbox = data.get("target_is_sandbox", True)
    overrides = data.get("overrides", {})
    pipeline_id = data.get("pipeline_id")
    log_messages = [f"Starting metadata preparation for File ID: {source_file_db_id}"]

    conn = get_db_connection(project_manager.db_path)
    try:
        # Step 1: Extract metadata and the original configuration from the primary source.
        extracted_metadata, file_info, mapping_config = _extract_and_prepare_metadata(conn, source_file_db_id)
        log_messages.append("Extracted base metadata from primary mapping source (e.g., spreadsheet).")
        logger.info(f"Initial metadata from spreadsheet: {json.dumps(extracted_metadata, indent=2)}")

        # Step 2: Handle 'construct_later' BEFORE pipeline overrides.
        if isinstance(extracted_metadata.get("description"), dict) and extracted_metadata["description"].get(
            "construct_later"
        ):
            log_messages.append("Auto-constructing default description...")
            title = extracted_metadata.get("title", file_info["filename"])
            extracted_metadata["description"] = f"Zenodo record for the data file: {title}."

        # Step 3: Apply mappings from pipeline outputs. This will overwrite values in `extracted_metadata`.
        if pipeline_id:
            log_messages.append(f"Applying output mappings from pipeline ID: {pipeline_id}")
            extracted_metadata, overwritten_keys = _apply_output_mappings(
                extracted_metadata, source_file_db_id, pipeline_id
            )

            # This loop modifies the original `mapping_config` in-place. It tells the final
            # saving function to use these new values as literals, ignoring the spreadsheet for these keys.
            if overwritten_keys:
                log_messages.append(f"Finalizing pipeline overwrites for fields: {list(overwritten_keys)}")
                for key in overwritten_keys:
                    # Create a dictionary for the key if it doesn't exist
                    if key not in mapping_config:
                        mapping_config[key] = {}
                    # Force the mapping type to 'literal' and set the value from the pipeline.
                    mapping_config[key]["type"] = "literal"
                    mapping_config[key]["value"] = extracted_metadata[key]
                    logger.info(
                        f"Permanently setting mapping for '{key}' to a literal value: '{extracted_metadata[key]}'"
                    )

        # Step 4: Apply final user overrides from the UI.
        if overrides:
            log_messages.append(f"Applying user overrides: {list(overrides.keys())}")
            extracted_metadata.update(overrides)

        # Step 5: Sanitize, prepare, validate, and store.
        keys_to_remove = [k for k, v in extracted_metadata.items() if v is None or v == ""]
        if keys_to_remove:
            for key in keys_to_remove:
                del extracted_metadata[key]

        zenodo_api_payload = prepare_zenodo_metadata(extracted_metadata)
        validation_errors = validate_zenodo_metadata(zenodo_api_payload)

        if validation_errors:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Metadata validation failed.",
                        "validation_errors": validation_errors,
                        "log": log_messages,
                    }
                ),
                400,
            )

        project_id = conn.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]
        store_metadata_for_file(
            conn,
            project_id,
            source_file_db_id,
            extracted_metadata,
            zenodo_api_payload,
            mapping_config,
            target_is_sandbox,
        )
        conn.commit()
        log_messages.append("Metadata stored successfully.")
        return jsonify(
            {"success": True, "message": "Metadata prepared and validated successfully.", "log": log_messages}
        )

    except Exception as e:
        logger.error(f"Error preparing metadata: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


# Zenodo API Interaction Routes
@zenodo_bp.route("/project/create_api_draft_for_prepared_record", methods=["POST"])
@project_required
def create_api_draft_for_prepared_record():
    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")

    if not local_record_db_id:
        return jsonify({"error": "Missing local_record_db_id"}), 400

    conn = get_db_connection(project_manager.db_path)
    try:
        record_info = conn.execute(
            "SELECT zr.source_file_id, zr.is_sandbox, zr.record_metadata_json, sf.filename FROM zenodo_records zr JOIN source_files sf ON zr.source_file_id = sf.file_id WHERE zr.record_id = ?",
            (local_record_db_id,),
        ).fetchone()

        if not record_info:
            return jsonify({"success": False, "error": f"No prepared record found with ID {local_record_db_id}."}), 404

        is_sandbox_env = bool(record_info["is_sandbox"])
        stored_payload = json.loads(record_info["record_metadata_json"])

        # This block defensively extracts ONLY the metadata, builds a new, clean payload,
        # and discards any other top-level fields (like 'id', 'doi', 'links') that may
        # have been saved from a previous API response. This prevents state corruption.
        if "metadata" in stored_payload and isinstance(stored_payload["metadata"], dict):
            metadata_to_send = stored_payload["metadata"]
        else:
            # If there's no 'metadata' key, the payload itself is the (potentially dirty) metadata.
            metadata_to_send = stored_payload

        # Build the final, guaranteed-clean payload for the API call.
        payload_to_send = {"metadata": metadata_to_send}

        api_params = get_api_params(is_sandbox_env)

        # Call the CLI helper, which expects a payload already wrapped in {"metadata": ...}
        return_msg, response_data = create_record_cli(
            zenodo_metadata=payload_to_send,
            sandbox_mode=is_sandbox_env,
            conn_params=api_params,
        )

        if return_msg["success"]:
            zenodo_record_id = response_data.get("id")
            zenodo_doi = response_data.get("doi")
            concept_rec_id = response_data.get("conceptrecid")

            # Overwrite the local record with the NEW, full response from Zenodo.
            conn.execute(
                """
                UPDATE zenodo_records
                SET record_status = 'draft', zenodo_record_id = ?, zenodo_doi = ?, concept_rec_id = ?, record_metadata_json = ?, last_updated_timestamp = ?
                WHERE record_id = ?
                """,
                (
                    zenodo_record_id,
                    zenodo_doi,
                    concept_rec_id,
                    json.dumps(response_data),
                    datetime.now(timezone.utc).isoformat(),
                    local_record_db_id,
                ),
            )

            source_file_db_id = record_info["source_file_id"]
            conn.execute(
                "INSERT OR IGNORE INTO record_files_map (record_id, file_id, upload_status) VALUES (?, ?, ?)",
                (local_record_db_id, source_file_db_id, "pending"),
            )
            conn.commit()

            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Zenodo draft record created successfully.",
                        "local_record_db_id": local_record_db_id,
                        "zenodo_response": response_data,
                    }
                ),
                200,
            )
        else:
            error_message = return_msg.get("text", "Failed to create Zenodo record")
            if return_msg.get("errors"):
                error_message += ": " + str(return_msg["errors"])

            return jsonify({"success": False, "error": error_message, "zenodo_response": response_data}), 500

    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/project/cli/create_api_draft", methods=["POST"])
def create_api_draft_for_cli():
    """
    Creates a Zenodo draft from a local record, specifically for the CLI.
    This endpoint ensures the payload sent to Zenodo is correctly structured
    and uses the globally loaded project database.
    """
    if not project_manager.is_loaded:
        return (
            jsonify({"success": False, "error": "No project loaded. Please ensure the --hdpc argument is correct."}),
            400,
        )

    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")
    if not local_record_db_id:
        return jsonify({"success": False, "error": "local_record_db_id is required."}), 400

    db_path = project_manager.db_path
    conn = None  # Initialize conn to None

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1. Fetch the existing record metadata from the database
        record_data = cursor.execute(
            "SELECT record_metadata_json, is_sandbox FROM zenodo_records WHERE record_id = ?",
            (local_record_db_id,),
        ).fetchone()

        if not record_data:
            return jsonify({"success": False, "error": f"Local record with ID {local_record_db_id} not found."}), 404

        # 2. Extract and prepare the metadata for the new deposition
        metadata_to_send = json.loads(record_data["record_metadata_json"])
        is_sandbox = bool(record_data["is_sandbox"])

        # Clean the metadata to remove Zenodo response fields
        response_only_keys = [
            "id",
            "doi",
            "recid",
            "links",
            "state",
            "submitted",
            "created",
            "modified",
            "owner",
            "record_id",
            "conceptrecid",
        ]
        for key in response_only_keys:
            metadata_to_send.pop(key, None)

        # 3. Call the Zenodo API service with the correctly wrapped payload
        from ..services.zenodo_api_service import create_new_deposition

        success, zenodo_response = create_new_deposition(is_sandbox, metadata_to_send)

        if not success:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Failed to create Zenodo Record: {zenodo_response.get('message', 'Unknown error')}",
                        "zenodo_response": zenodo_response,
                    }
                ),
                500,
            )

        # 4. Update the local record with the new Zenodo deposition ID
        zenodo_deposition_id = zenodo_response.get("id")
        execute_db_transaction(
            db_path,
            [
                (
                    "UPDATE zenodo_records SET zenodo_record_id = ?, record_metadata_json = ?, record_status = 'draft' WHERE record_id = ?",
                    (zenodo_deposition_id, json.dumps(zenodo_response), local_record_db_id),
                )
            ],
        )
        current_app.logger.info(
            f"CLI: Successfully created draft {zenodo_deposition_id} for local record {local_record_db_id}."
        )
        return jsonify({"success": True, "zenodo_response": zenodo_response}), 200

    except Exception as e:
        current_app.logger.error(f"Error in CLI draft creation for record {local_record_db_id}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/project/upload_file_to_deposition", methods=["POST"])
@project_required
def upload_file_to_deposition_route():
    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")
    source_file_db_id = data.get("source_file_db_id")

    with get_db_connection(project_manager.db_path) as conn:
        record_row = conn.execute(
            "SELECT record_metadata_json, is_sandbox FROM zenodo_records WHERE record_id = ?", (local_record_db_id,)
        ).fetchone()
        file_row = conn.execute(
            "SELECT absolute_path FROM source_files WHERE file_id = ?", (source_file_db_id,)
        ).fetchone()
        if not record_row or not file_row:
            return jsonify({"error": "Record or file not found in local DB"}), 404

        is_sandbox = bool(record_row["is_sandbox"])
        record_api_data = json.loads(record_row["record_metadata_json"])
        bucket_url = record_api_data.get("links", {}).get("bucket")
        if not bucket_url:
            return jsonify({"error": "Bucket URL not found in Zenodo record data"}), 500

        file_path = Path(file_row["absolute_path"])
        api_params = get_api_params(is_sandbox)

        with open(file_path, "rb") as fp:
            upload_response = requests.put(f"{bucket_url}/{file_path.name}", data=fp, params=api_params)

        if upload_response.status_code in [200, 201]:
            # Update local DB status
            execute_db(
                project_manager.db_path,
                "UPDATE record_files_map SET upload_status = 'uploaded' WHERE record_id = ? AND file_id = ?",
                (local_record_db_id, source_file_db_id),
            )
            return jsonify(
                {"success": True, "message": "File uploaded successfully.", "zenodo_response": upload_response.json()}
            )
        else:
            return (
                jsonify({"success": False, "error": f"Upload failed: {upload_response.text}"}),
                upload_response.status_code,
            )


@zenodo_bp.route("/project/publish_record", methods=["POST"])
@project_required
def publish_record_route():
    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")
    log_messages = [f"Attempting to publish record with DB ID: {local_record_db_id}"]

    with get_db_connection(project_manager.db_path) as conn:
        record_row = conn.execute("SELECT * FROM zenodo_records WHERE record_id = ?", (local_record_db_id,)).fetchone()
        if not record_row:
            log_messages.append("Error: Record not found in local DB.")
            return jsonify({"error": "Record not found in local DB", "log": log_messages}), 404

        is_sandbox = bool(record_row["is_sandbox"])
        api_params = get_api_params(is_sandbox)
        base_url = get_base_url(is_sandbox)
        log_messages.append(f"Publishing to {'Sandbox' if is_sandbox else 'Production'} environment.")

        msg_dict, api_response = publish_record(
            record_data_from_db=record_row, conn=conn, conn_params=api_params, base_url=base_url
        )

        log_messages.append(f"API response: {msg_dict.get('text', 'No message from API call.')}")

        if msg_dict.get("success"):
            return jsonify(
                {
                    "success": True,
                    "message": "Record published successfully.",
                    "zenodo_response": api_response,
                    "log": log_messages,
                }
            )
        else:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": msg_dict.get("text", "Unknown publishing error"),
                        "zenodo_response": api_response,
                        "log": log_messages,
                    }
                ),
                500,
            )


@zenodo_bp.route("/project/discard_zenodo_draft", methods=["POST"])
@project_required
def discard_zenodo_draft_route():
    """
    Discards a draft on Zenodo and restores the local metadata to its
    pre-pipeline state from a backup.
    """
    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")

    # Step 1: Discard the draft on Zenodo's side (existing logic)
    try:
        with get_db_connection(project_manager.db_path) as conn:
            record = conn.execute(
                "SELECT record_metadata_json, is_sandbox FROM zenodo_records WHERE record_id = ?",
                (local_record_db_id,),
            ).fetchone()
            if not record:
                return jsonify({"error": "Record not found"}), 404

            is_sandbox = bool(record["is_sandbox"])
            api_params = get_api_params(is_sandbox)
            full_api_response = json.loads(record["record_metadata_json"])
            discard_link = full_api_response.get("links", {}).get("discard")

            if discard_link:
                return_msg, _ = discard_draft_cli(discard_link=discard_link, conn_params=api_params)
                if not return_msg.get("success"):
                    logger.warning(
                        f"Failed to discard draft on Zenodo for record {local_record_db_id}, but proceeding with local restoration."
                    )
            else:
                logger.warning(
                    f"No discard link found for record {local_record_db_id}. It may have been already deleted on Zenodo."
                )

    except Exception as e:
        logger.error(f"An error occurred during Zenodo API discard call: {e}", exc_info=True)
        # We proceed to local restoration even if API fails, as the user wants to revert the state.

    # Step 2: Restore the metadata from backup
    _restore_record_metadata(local_record_db_id)

    return jsonify({"success": True, "message": "Draft discarded and local metadata restored."})


@zenodo_bp.route("/project/uploadable_files", methods=["GET"])
@project_required
def get_uploadable_files_route():
    conn = None
    try:
        conn = get_db_connection(project_manager.db_path)
        cursor = conn.cursor()
        project_id_row = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()
        if not project_id_row:
            return jsonify({"error": "Project ID not found"}), 500
        project_id = project_id_row["project_id"]

        all_actionable_files = []

        # 1. Files needing METADATA PREPARATION
        query_needs_metadata_prep = """
            SELECT
                sf.file_id AS source_file_db_id, sf.filename, sf.absolute_path, sf.status AS file_db_status,
                'action_prepare_metadata' AS required_action
            FROM source_files sf
            LEFT JOIN zenodo_records zr ON sf.file_id = zr.source_file_id 
                                        AND zr.record_status IN ('prepared', 'draft', 'published') 
            WHERE sf.project_id = ? 
              AND sf.status IN ('pending', 'source_added', 'metadata_error') 
              AND zr.record_id IS NULL
            ORDER BY sf.filename ASC;
        """
        cursor.execute(query_needs_metadata_prep, (project_id,))
        files_for_metadata_prep = [dict(row) for row in cursor.fetchall()]
        all_actionable_files.extend(files_for_metadata_prep)

        # 2. Files with 'prepared' Zenodo records, needing API DRAFT CREATION
        query_needs_api_draft = """
            SELECT
                sf.file_id AS source_file_db_id, sf.filename, sf.absolute_path, sf.status AS file_db_status,
                zr.record_id AS local_record_db_id, zr.record_title, zr.is_sandbox,
                zr.record_status AS zenodo_record_db_status,
                'action_create_api_draft' AS required_action
            FROM source_files sf
            JOIN zenodo_records zr ON sf.file_id = zr.source_file_id
            WHERE zr.project_id = ?
              AND zr.record_status = 'prepared' 
              AND zr.zenodo_record_id IS NULL
            ORDER BY sf.filename ASC;
        """
        cursor.execute(query_needs_api_draft, (project_id,))
        files_for_api_draft = [dict(row) for row in cursor.fetchall()]
        all_actionable_files.extend(files_for_api_draft)

        # 3. Files part of existing API drafts needing FILE UPLOAD
        is_sandbox_for_drafts = request.args.get("is_sandbox_for_drafts", "true").lower() == "true"
        query_needs_file_upload = """
            SELECT
                sf.file_id AS source_file_db_id, sf.filename, sf.absolute_path, sf.status AS file_db_status,
                zr.record_id AS local_record_db_id, zr.zenodo_record_id AS zenodo_api_deposition_id,
                zr.record_title, zr.record_status AS zenodo_record_db_status, zr.is_sandbox,
                rfm.upload_status AS file_upload_on_zenodo_status,
                'action_upload_file' AS required_action
            FROM source_files sf
            JOIN record_files_map rfm ON sf.file_id = rfm.file_id
            JOIN zenodo_records zr ON rfm.record_id = zr.record_id
            WHERE zr.project_id = ? AND zr.is_sandbox = ?
              AND zr.record_status = 'draft' AND zr.zenodo_record_id IS NOT NULL
              AND (rfm.upload_status = 'pending' OR rfm.upload_status LIKE '%error%' OR rfm.upload_status = 'pending_pipeline_upload')
            ORDER BY zr.record_id DESC, sf.filename ASC;
        """
        cursor.execute(query_needs_file_upload, (project_id, 1 if is_sandbox_for_drafts else 0))
        files_for_upload = [dict(row) for row in cursor.fetchall()]
        all_actionable_files.extend(files_for_upload)

        return jsonify(all_actionable_files)
    except Exception as e:
        logger.error(f"Error in get_uploadable_files_route: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/project/uploads_by_tab", methods=["GET"])
@project_required
def get_uploads_by_tab_route():
    # --- Parameter retrieval ---
    tab_id = request.args.get("tab_id", "pending_preparation")
    is_sandbox_environment = request.args.get("is_sandbox", "true").lower() == "true"

    # --- Retrieve all filter parameters from the request ---
    search_term = request.args.get("search")
    title_pattern = request.args.get("title_pattern")
    date_since = request.args.get("date_since")
    date_until = request.args.get("date_until")

    conn = None
    try:
        conn = get_db_connection(project_manager.db_path)
        cursor = conn.cursor()
        project_id = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]

        # --- Dynamic Query Building ---
        # Base queries for each tab remain the same, but we add placeholders for filters.
        # WHERE clauses are appended dynamically here.
        params = [project_id]
        where_clauses = []

        # The base query structure for each tab
        queries = {
            "pending_preparation": {
                "select": "SELECT sf.file_id AS source_file_db_id, sf.filename, sf.absolute_path, sf.status AS file_db_status, 'action_prepare_metadata' AS required_action",
                "from": "FROM source_files sf LEFT JOIN zenodo_records zr ON sf.file_id = zr.source_file_id",
                "where": "sf.project_id = ? AND sf.status IN ('pending', 'source_added', 'metadata_error', 'verified') AND (zr.record_id IS NULL OR zr.record_status IN ('preparation_failed', 'discarded'))",
                "order": "ORDER BY sf.filename ASC",
            },
            "pending_preparation": {
                "select": "SELECT sf.file_id AS source_file_db_id, sf.filename, sf.absolute_path, sf.status AS file_db_status, 'action_prepare_metadata' AS required_action",
                "from": "FROM source_files sf LEFT JOIN zenodo_records zr ON sf.file_id = zr.source_file_id",
                "where": "sf.project_id = ? AND sf.status IN ('pending', 'source_added', 'metadata_error', 'verified', 'Valid', 'Invalid', 'Problems', 'MTL Missing', 'Textures Missing', 'File Conflict') AND (zr.record_id IS NULL OR zr.record_status IN ('preparation_failed', 'discarded'))",
                "order": "ORDER BY sf.filename ASC",
            },
            "drafts": {
                "select": "SELECT zr.record_id AS local_record_db_id, zr.record_title, zr.record_status AS zenodo_record_db_status, zr.is_sandbox, zr.zenodo_record_id AS zenodo_api_deposition_id, zr.record_metadata_json, sf.filename, (SELECT COUNT(*) FROM record_files_map WHERE record_id = zr.record_id) AS total_files_in_record, (SELECT COUNT(*) FROM record_files_map WHERE record_id = zr.record_id AND upload_status = 'uploaded') AS uploaded_files_in_record",
                "from": "FROM zenodo_records zr JOIN source_files sf ON zr.source_file_id = sf.file_id",
                "where": "zr.project_id = ? AND zr.record_status = 'draft' AND zr.zenodo_record_id IS NOT NULL AND zr.is_sandbox = ?",
                "order": "ORDER BY zr.last_updated_timestamp DESC",
            },
            "published": {
                "select": "SELECT zr.record_id AS local_record_db_id, zr.record_title, zr.zenodo_doi, zr.concept_rec_id, zr.version, sf.filename, zr.zenodo_record_id AS zenodo_api_deposition_id",
                "from": "FROM zenodo_records zr JOIN source_files sf ON zr.source_file_id = sf.file_id",
                "where": "zr.project_id = ? AND zr.record_status = 'published' AND zr.is_sandbox = ?",
                "order": "ORDER BY zr.concept_rec_id, zr.version DESC",
            },
            "versioning": {"select": "", "from": "", "where": "", "order": ""},  # Stays empty
        }

        if tab_id not in queries or not queries[tab_id]["select"]:
            return jsonify([]) if tab_id == "versioning" else jsonify({"error": "Invalid tab_id"}), 400

        query_parts = queries[tab_id]
        base_where = query_parts["where"]

        # Add sandbox parameter for relevant tabs
        if tab_id in ["pending_operations", "drafts", "published"]:
            params.append(1 if is_sandbox_environment else 0)

        # Apply filters (only for tabs that show records with titles/dates)
        if tab_id in ["pending_operations", "drafts", "published"]:
            if search_term:
                where_clauses.append("(zr.record_title LIKE ? OR sf.filename LIKE ?)")
                params.extend([f"%{search_term}%", f"%{search_term}%"])
            if title_pattern:
                # Convert wildcard to SQL LIKE syntax
                sql_pattern = title_pattern.replace("*", "%")
                where_clauses.append("zr.record_title LIKE ?")
                params.append(sql_pattern)
            if date_since:
                where_clauses.append("zr.created_timestamp >= ?")
                params.append(date_since)
            if date_until:
                # Add time part to make the comparison inclusive of the whole day
                where_clauses.append("zr.created_timestamp <= ?")
                params.append(f"{date_until}T23:59:59.999Z")

        # Combine all clauses into a final query string
        final_where = base_where
        if where_clauses:
            final_where += " AND " + " AND ".join(where_clauses)

        final_query = f"{query_parts['select']} {query_parts['from']} WHERE {final_where} {query_parts['order']};"

        cursor.execute(final_query, tuple(params))
        results = [dict(row) for row in cursor.fetchall()]

        # Post-processing for drafts
        if tab_id == "drafts":
            for record in results:
                if record.get("record_metadata_json"):
                    try:
                        meta_json = json.loads(record["record_metadata_json"])
                        record["discard_link"] = meta_json.get("links", {}).get("discard")
                    except json.JSONDecodeError:
                        record["discard_link"] = None

        return jsonify(results)

    except Exception as e:
        logger.error(f"Error in get_uploads_by_tab_route: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/project/metadata/load_file_preview", methods=["POST"])
def route_load_metadata_file_preview():
    data = request.get_json()
    file_path_str = data.get("filePath")
    file_format = data.get("fileFormat", "csv")

    if not file_path_str or not Path(file_path_str).is_file():
        return jsonify({"success": False, "error": "File not found"}), 400

    try:
        if file_format == "csv":
            df = pd.read_csv(Path(file_path_str))
        elif file_format == "excel":
            df = pd.read_excel(Path(file_path_str))
        else:
            return jsonify({"success": False, "error": "Unsupported file format."}), 400

        columns = list(df.columns)
        preview_data = df.head(5).to_dict(orient="records")

        return jsonify({"success": True, "columns": columns, "previewData": preview_data, "rowCount": len(df)})
    except Exception as e:
        return jsonify({"success": False, "error": f"Error loading file: {str(e)}"}), 500


@zenodo_bp.route("/project/create_zenodo_record_for_file", methods=["POST"])
@project_required
def create_zenodo_record_for_file_route():
    data = request.get_json()
    source_file_db_id = data.get("source_file_db_id")
    is_sandbox_env = data.get("is_sandbox", True)

    if not source_file_db_id:
        return jsonify({"error": "Missing source_file_db_id"}), 400

    conn = get_db_connection(project_manager.db_path)
    try:
        source_file_row = conn.execute("SELECT * FROM source_files WHERE file_id = ?", (source_file_db_id,)).fetchone()
        if not source_file_row:
            return jsonify({"success": False, "error": "Source file not found."}), 404

        project_id = source_file_row["project_id"]
        metadata_dict_for_api = {
            "title": f"Record for {source_file_row['filename']}",
            "upload_type": "other",
            "description": f"Zenodo record automatically created for source file: {source_file_row['filename']}",
            "creators": [{"name": "Heritage Data Processor User"}],
        }

        api_params = get_api_params(is_sandbox_env)
        base_url = get_base_url(is_sandbox_env)

        success_flag, response_data, new_record_db_id = create_record_cli(
            project_id=project_id,
            source_file_id=source_file_db_id,
            metadata_dict_for_api=metadata_dict_for_api,
            is_sandbox=is_sandbox_env,
            conn=conn,
            conn_params=api_params,
            base_url=base_url,
        )

        if success_flag:
            return jsonify(
                {
                    "success": True,
                    "message": "Zenodo draft record created successfully.",
                    "local_record_db_id": new_record_db_id,
                    "zenodo_response": response_data,
                }
            )
        else:
            return jsonify({"success": False, "error": f"Failed to create Zenodo record: {response_data}"}), 500

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/project/upload_files_for_deposition", methods=["POST"])
@project_required
def upload_files_for_deposition_route():
    data = request.get_json()
    local_record_db_id = data.get("local_record_db_id")
    if not local_record_db_id:
        return jsonify({"success": False, "error": "Missing local_record_db_id"}), 400

    log_messages = [f"Starting file uploads for record ID: {local_record_db_id}"]
    conn = get_db_connection(project_manager.db_path)

    try:
        record_row = conn.execute(
            "SELECT record_metadata_json, is_sandbox FROM zenodo_records WHERE record_id = ?", (local_record_db_id,)
        ).fetchone()
        if not record_row:
            return jsonify({"success": False, "error": "Record not found in local DB", "log": log_messages}), 404

        is_sandbox = bool(record_row["is_sandbox"])
        record_api_data = json.loads(record_row["record_metadata_json"])
        bucket_url = record_api_data.get("links", {}).get("bucket")
        if not bucket_url:
            return (
                jsonify(
                    {"success": False, "error": "Bucket URL not found in Zenodo record data", "log": log_messages}
                ),
                500,
            )

        api_params = get_api_params(is_sandbox)

        logger.info(f"--- INSIDE UPLOAD ENDPOINT FOR RECORD ID: {local_record_db_id} ---")
        all_linked_files = query_db(
            project_manager.db_path,
            """
            SELECT
                rfm.file_id,
                sf.filename,
                sf.absolute_path,
                sf.file_type,
                rfm.upload_status
            FROM record_files_map rfm
            JOIN source_files sf ON rfm.file_id = sf.file_id
            WHERE rfm.record_id = ?
            """,
            (local_record_db_id,),
        )
        logger.info(f"Found {len(all_linked_files)} total file links for this record:")
        for f in all_linked_files:
            logger.info(
                f"  - File ID: {f['file_id']}, Name: {f['filename']}, Type: {f['file_type']}, Status: {f['upload_status']}"
            )
        logger.info("--- END INSIDE UPLOAD ENDPOINT CHECK ---")

        # Find all pending files for this record
        pending_files_query = """
            SELECT sf.file_id, sf.absolute_path, sf.filename
            FROM source_files sf
            JOIN record_files_map rfm ON sf.file_id = rfm.file_id
            WHERE rfm.record_id = ? AND rfm.upload_status = 'pending'
        """
        pending_files = conn.execute(pending_files_query, (local_record_db_id,)).fetchall()

        if not pending_files:
            log_messages.append("No pending files found to upload for this record.")
            return jsonify({"success": True, "message": "No pending files to upload.", "log": log_messages})

        log_messages.append(f"Found {len(pending_files)} file(s) to upload.")

        success_count = 0
        error_count = 0

        for file_to_upload in pending_files:
            file_path = Path(file_to_upload["absolute_path"])
            source_file_db_id = file_to_upload["file_id"]
            log_messages.append(f"Uploading '{file_path.name}'...")

            try:
                with open(file_path, "rb") as fp:
                    upload_response = requests.put(f"{bucket_url}/{file_path.name}", data=fp, params=api_params)

                if upload_response.status_code in [200, 201]:
                    log_messages.append(f"Successfully uploaded '{file_path.name}'.")
                    conn.execute(
                        "UPDATE record_files_map SET upload_status = 'uploaded' WHERE record_id = ? AND file_id = ?",
                        (local_record_db_id, source_file_db_id),
                    )
                    success_count += 1
                else:
                    error_count += 1
                    error_text = upload_response.text
                    log_messages.append(f"ERROR uploading '{file_path.name}': {error_text}")
                    conn.execute(
                        "UPDATE record_files_map SET upload_status = 'upload_error', upload_error = ? WHERE record_id = ? AND file_id = ?",
                        (error_text, local_record_db_id, source_file_db_id),
                    )
            except Exception as e:
                error_count += 1
                log_messages.append(f"EXCEPTION during upload of '{file_path.name}': {e}")
                conn.execute(
                    "UPDATE record_files_map SET upload_status = 'upload_error', upload_error = ? WHERE record_id = ? AND file_id = ?",
                    (str(e), local_record_db_id, source_file_db_id),
                )

        conn.commit()

        final_message = f"Upload process finished. {success_count} succeeded, {error_count} failed."
        return jsonify({"success": error_count == 0, "message": final_message, "log": log_messages})

    except Exception as e:
        logger.error(f"Error during file uploads for record {local_record_db_id}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


def publish_record(
    record_data_from_db: sqlite3.Row,
    conn: sqlite3.Connection,
    conn_params: Dict[str, str],
    base_url: str,  # e.g., https://sandbox.zenodo.org or https://zenodo.org
) -> Tuple[Dict[str, Union[bool, int, str, List[str]]], Dict[str, Any]]:
    """
    Publishes a single Zenodo draft record. Handles HTTP 500 errors by
    re-verifying against the /api/records/{id} endpoint.
    """
    # Initialize return structures
    # return_msg: for user feedback & high-level logging
    # api_response_data: for the actual data from Zenodo (published record or error details)
    return_msg = {"success": False, "response_initial_status": 0, "response_initial_text": "", "errors": []}
    api_response_data = {}

    local_db_record_id = record_data_from_db["record_id"]
    source_file_id = record_data_from_db["source_file_id"]

    cursor = conn.cursor()
    try:
        project_id_for_log = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()[0]
    except Exception as e:
        # Fallback if project_id cannot be fetched, though this indicates a bigger DB issue
        print(f"Critical Error: Could not fetch project_id for logging: {e}", file=sys.stderr)
        project_id_for_log = -1  # Indicate an error in logging project_id

    try:
        draft_api_response_json_str = record_data_from_db["record_metadata_json"]
        if not draft_api_response_json_str:
            raise ValueError("Stored record_metadata_json for the draft is empty or missing.")

        draft_api_response = json.loads(draft_api_response_json_str)
        publish_link = draft_api_response.get("links", {}).get("publish")
        # This is the deposition ID, which becomes the record ID upon publishing
        deposition_id_for_recheck = draft_api_response.get("id")

        if not publish_link:
            return_msg["errors"].append("Could not find the 'publish' action link in the draft's metadata.")
            return_msg["response_initial_text"] = "Publish link missing in draft."
            if return_msg.get("errors"):
                return_msg["text"] = ". ".join(map(str, return_msg["errors"]))
            return return_msg, draft_api_response  # Return original draft if essential link is missing

        rate_limiter_zenodo.wait_for_rate_limit()
        r_publish = requests.post(publish_link, params=conn_params, timeout=120)  # Publish attempt
        rate_limiter_zenodo.record_request()

        return_msg["response_initial_status"] = r_publish.status_code
        try:
            # Attempt to parse the initial response, store raw text if not JSON
            initial_api_response_data = r_publish.json()
            return_msg["response_initial_text"] = json.dumps(initial_api_response_data)
        except json.JSONDecodeError:
            initial_api_response_data = {"raw_response_text": r_publish.text}
            return_msg["response_initial_text"] = r_publish.text

        # Default to the initial response data, may be overwritten by re-check
        api_response_data = initial_api_response_data
        log_status = "error"

        if r_publish.status_code == 202:  # Standard success for publish
            return_msg["success"] = True
            log_status = "success"
            # api_response_data already holds the parsed JSON from the 202 response

            cursor.execute(
                """
                UPDATE zenodo_records
                SET record_status = 'published',
                    zenodo_doi = ?, concept_doi = ?, concept_rec_id = ?, record_metadata_json = ?, 
                    last_publish_api_response = ?, 
                    last_api_error = NULL, last_updated_timestamp = CURRENT_TIMESTAMP
                WHERE record_id = ?
                """,
                (
                    api_response_data.get("doi"),
                    api_response_data.get("conceptdoi"),
                    api_response_data.get("conceptrecid"),
                    json.dumps(api_response_data),
                    json.dumps(return_msg),
                    local_db_record_id,
                ),
            )
        elif r_publish.status_code == 500:
            print(
                f"   ℹ️ Received HTTP 500. Attempting to re-verify actual publish status for Zenodo ID {deposition_id_for_recheck}...",
                file=sys.stderr,
            )
            return_msg["errors"].append(f"Initial publish call returned HTTP 500.")

            if deposition_id_for_recheck:
                # Construct the URL for the PUBLISHED record, not the deposition
                refetch_published_record_url = f"{base_url}/api/records/{deposition_id_for_recheck}"
                print(f"   Re-checking published record URL: {refetch_published_record_url}", file=sys.stderr)
                try:
                    rate_limiter_zenodo.wait_for_rate_limit()
                    r_refetch = requests.get(refetch_published_record_url, params=conn_params, timeout=30)
                    rate_limiter_zenodo.record_request()

                    return_msg["response_recheck_status"] = r_refetch.status_code

                    if r_refetch.status_code == 200:
                        refetched_published_data = r_refetch.json()
                        api_response_data = refetched_published_data  # This is now the definitive data
                        return_msg["response_recheck_text"] = json.dumps(refetched_published_data)

                        # If we get a 200 from /api/records/{id}, it's published.
                        print(
                            f"   ✅ Re-verification successful: Record [{local_db_record_id}] is PUBLISHED.",
                            file=sys.stderr,
                        )
                        return_msg["success"] = True
                        log_status = "success"
                        return_msg["errors"].append(
                            f"Re-verification via /api/records/{deposition_id_for_recheck} confirmed record is published."
                        )

                        cursor.execute(
                            """
                            UPDATE zenodo_records
                            SET record_status = 'published',
                                zenodo_doi = ?, concept_doi = ?, concept_rec_id = ?, record_metadata_json = ?, 
                                last_publish_api_response = ?, 
                                last_api_error = NULL, last_updated_timestamp = CURRENT_TIMESTAMP
                            WHERE record_id = ?
                            """,
                            (
                                refetched_published_data.get("doi"),
                                refetched_published_data.get("conceptdoi"),
                                refetched_published_data.get("conceptrecid"),
                                json.dumps(refetched_published_data),
                                json.dumps(return_msg),
                                local_db_record_id,
                            ),
                        )
                    elif r_refetch.status_code == 404:  # Not found at /api/records implies not published
                        print(
                            f"   ⚠️ Re-verification via /api/records/{deposition_id_for_recheck} returned 404. Record likely NOT published.",
                            file=sys.stderr,
                        )
                        return_msg["success"] = False
                        return_msg["errors"].append(
                            f"Re-verification via /api/records/{deposition_id_for_recheck} failed (404 Not Found)."
                        )
                        return_msg["response_recheck_text"] = r_refetch.text
                    else:  # Other error during re-fetch of /api/records
                        print(
                            f"   ⚠️ Re-verification via /api/records/{deposition_id_for_recheck} failed with HTTP {r_refetch.status_code}. Status uncertain.",
                            file=sys.stderr,
                        )
                        return_msg["success"] = False
                        return_msg["errors"].append(
                            f"Re-verification via /api/records/ HTTP status: {r_refetch.status_code}. Response: {r_refetch.text[:100]}..."
                        )
                        try:
                            return_msg["response_recheck_text"] = r_refetch.json()
                        except json.JSONDecodeError:
                            return_msg["response_recheck_text"] = r_refetch.text
                except requests.exceptions.RequestException as re_e:
                    print(f"   ⚠️ Network error during re-verification: {re_e}. Status uncertain.", file=sys.stderr)
                    return_msg["success"] = False
                    return_msg["errors"].append(f"Re-verification network error: {str(re_e)}")
                except json.JSONDecodeError as jd_e:  # If re-fetch response is not valid JSON
                    print(f"   ⚠️ Error parsing re-verification response: {jd_e}. Status uncertain.", file=sys.stderr)
                    return_msg["success"] = False
                    return_msg["errors"].append(
                        f"Re-verification JSON parse error: {str(jd_e)}. Raw text: {r_refetch.text[:100]}..."
                    )
            else:  # No deposition_id for re-fetch
                print(
                    f"   ⚠️ Cannot re-verify status (no deposition ID in draft data). Treating initial 500 as failure.",
                    file=sys.stderr,
                )
                return_msg["success"] = False
                return_msg["errors"].append("Cannot re-verify: Deposition ID missing from draft data.")

            if not return_msg["success"]:  # If still not successful after 500 and re-check attempt
                if return_msg.get("errors"):
                    return_msg["text"] = ". ".join(map(str, return_msg["errors"]))
                cursor.execute(
                    "UPDATE zenodo_records SET last_api_error = ?, last_updated_timestamp = CURRENT_TIMESTAMP WHERE record_id = ?",
                    (json.dumps(return_msg), local_db_record_id),
                )
        else:  # Other non-202, non-500 errors from initial publish call
            return_msg["success"] = False
            if isinstance(api_response_data.get("errors"), list):
                return_msg["errors"] = [
                    str(e.get("message", e) if isinstance(e, dict) else e) for e in api_response_data["errors"]
                ]
            elif isinstance(api_response_data.get("message"), str):
                return_msg["errors"] = [api_response_data["message"]]
            elif "raw_response_text" in api_response_data:
                return_msg["errors"] = [
                    f"HTTP {r_publish.status_code}: {api_response_data['raw_response_text'][:200]}..."
                ]
            else:
                return_msg["errors"] = [f"HTTP {r_publish.status_code}: {r_publish.reason}"]

            if return_msg.get("errors"):
                return_msg["text"] = ". ".join(map(str, return_msg["errors"]))
            cursor.execute(
                "UPDATE zenodo_records SET last_api_error = ?, last_updated_timestamp = CURRENT_TIMESTAMP WHERE record_id = ?",
                (json.dumps(return_msg), local_db_record_id),
            )

        # Log the API call (log_status reflects the final outcome)
        # The response_body in api_log will now be our comprehensive return_msg
        cursor.execute(
            """
            INSERT INTO api_log
            (project_id, record_id, file_id, http_method, endpoint_url, 
             request_body, response_status_code, response_body, status)
            VALUES (?, ?, ?, 'POST', ?, ?, ?, ?, ?)
            """,
            (
                project_id_for_log,
                local_db_record_id,
                source_file_id,
                publish_link,
                None,
                r_publish.status_code,  # Log the initial publish attempt's status code
                json.dumps(return_msg),  # Log our detailed message object as the body
                log_status,
            ),
        )
        conn.commit()

    except ValueError as e:
        error_msg_text = f"Data error for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text  # Overwrite text with this critical error
        return_msg["errors"].append(str(e))
        print(f"Error: {error_msg_text}", file=sys.stderr)
    except json.JSONDecodeError as e:
        error_msg_text = f"Failed to parse stored JSON for record_metadata_json (local DB ID {local_db_record_id}): {e}. Raw data: '{record_data_from_db['record_metadata_json'][:200]}...'"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"Error: {error_msg_text}", file=sys.stderr)
    except requests.exceptions.RequestException as e:
        error_msg_text = f"Network error during initial publish for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"Error: {error_msg_text}", file=sys.stderr)
    except sqlite3.Error as e:
        error_msg_text = f"Database error during publish operation for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"Error: {error_msg_text}", file=sys.stderr)
        if conn:
            conn.rollback()
    except Exception as e:
        error_msg_text = f"An unexpected error occurred in publish_record_cli for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"Error: {error_msg_text}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        if conn:
            conn.rollback()

    return return_msg, api_response_data


@zenodo_bp.route("/project/preview_mapped_values", methods=["POST"])
@project_required
def preview_mapped_values_route():
    data = request.get_json()
    source_file_db_id = data.get("source_file_db_id")

    conn = get_db_connection(project_manager.db_path)
    try:
        # Step 1: Extract all metadata using the corrected helper
        extracted_metadata, file_info, _ = _extract_and_prepare_metadata(conn, source_file_db_id)

        # Step 2: Auto-construct description if needed (for preview consistency)
        if isinstance(extracted_metadata.get("description"), dict) and extracted_metadata["description"].get(
            "construct_later"
        ):
            title = extracted_metadata.get("title", file_info["filename"])
            extracted_metadata["description"] = f"Zenodo record for the data file: {title}."

        return jsonify(
            {
                "success": True,
                "filename": file_info["filename"],
                "prepared_metadata": {"metadata": extracted_metadata},
            }
        )

    except Exception as e:
        logger.error(f"Error previewing mapped values: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


def create_new_version_draft(concept_rec_id: str, is_sandbox: bool) -> dict:
    """
    Creates a new version of an existing Zenodo record. It fetches the latest
    version, increments its version number, creates a new draft via the API,
    and immediately updates that draft with the correctly incremented version.
    If a draft already exists, it returns that draft instead.
    """
    logger.info(f"Attempting to create or find a new version for concept ID: {concept_rec_id}")

    conn = get_db_connection(project_manager.db_path)
    try:
        # Check for an existing draft first
        existing_draft = query_db(
            project_manager.db_path,
            """
            SELECT record_id, record_metadata_json FROM zenodo_records
            WHERE concept_rec_id = ? AND record_status = 'draft' AND is_sandbox = ?
            LIMIT 1
            """,
            (concept_rec_id, 1 if is_sandbox else 0),
        )

        if existing_draft:
            logger.warning(
                f"An existing draft (DB ID: {existing_draft[0]['record_id']}) was found for concept ID {concept_rec_id}. Re-using it."
            )
            return {
                "success": True,
                "new_local_record_id": existing_draft[0]["record_id"],
                "zenodo_response": json.loads(existing_draft[0]["record_metadata_json"]),
                "message": "Re-used existing draft.",
            }

        # Find the latest PUBLISHED record for this concept to get the 'newversion' link and old version number
        latest_version_record = query_db(
            project_manager.db_path,
            """
            SELECT record_metadata_json, source_file_id, project_id
            FROM zenodo_records
            WHERE concept_rec_id = ? AND record_status = 'published' AND is_sandbox = ?
            ORDER BY version DESC LIMIT 1
            """,
            (concept_rec_id, 1 if is_sandbox else 0),
        )

        if not latest_version_record:
            raise Exception(f"No published record found for concept ID {concept_rec_id} in the specified environment.")

        latest_metadata = json.loads(latest_version_record[0]["record_metadata_json"])
        new_version_url = latest_metadata.get("links", {}).get("newversion")

        if not new_version_url:
            raise Exception(f"Could not find 'newversion' link for the latest version of concept ID {concept_rec_id}.")

        # Version Increment Logic
        previous_version_str = latest_metadata.get("metadata", {}).get("version", "0.0.0")
        new_version_str = ""
        try:
            parts = previous_version_str.split(".")
            # Handle semantic versions like "0.0.1", "1.2.3", etc.
            if len(parts) == 3 and all(p.isdigit() for p in parts):
                parts[-1] = str(int(parts[-1]) + 1)
                new_version_str = ".".join(parts)
            # Handle simple versions like "v1", "v2", etc.
            elif previous_version_str.startswith("v") and previous_version_str[1:].isdigit():
                version_number = int(previous_version_str[1:])
                new_version_str = f"v{version_number + 1}"
            # Fallback for any other non-standard version string
            else:
                new_version_str = f"{previous_version_str}-new"
        except (ValueError, IndexError):
            # General fallback if parsing fails
            new_version_str = f"{previous_version_str}-new"
        logger.info(f"Calculated new version: {previous_version_str} -> {new_version_str}")

        # Make the API call to create the new version draft
        api_params = get_api_params(is_sandbox)
        response = requests.post(new_version_url, params=api_params, json={}, timeout=60)
        response.raise_for_status()

        new_draft_data = response.json()
        logger.info(f"Successfully created initial Zenodo draft with ID: {new_draft_data.get('id')}")

        # Immediately update the version of the new draft
        update_url = new_draft_data.get("links", {}).get("self")
        if not update_url:
            raise Exception("New draft created, but it is missing the 'self' link for updates.")

        update_payload = {"metadata": new_draft_data.get("metadata", {})}
        update_payload["metadata"]["version"] = new_version_str

        logger.info(f"Updating new draft with correct version: {new_version_str}")
        update_response = requests.put(update_url, params=api_params, json=update_payload, timeout=60)
        update_response.raise_for_status()

        # Use the data from the final update response as the source of truth
        final_draft_data = update_response.json()
        final_metadata = final_draft_data.get("metadata", {})

        # Create a new record in the local database for this new draft
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO zenodo_records 
                (project_id, source_file_id, record_status, is_sandbox, zenodo_record_id, 
                zenodo_doi, concept_rec_id, version, record_title, record_metadata_json, 
                created_timestamp, last_updated_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    latest_version_record[0]["project_id"],
                    latest_version_record[0]["source_file_id"],
                    "draft",
                    1 if is_sandbox else 0,
                    final_draft_data.get("id"),
                    final_draft_data.get("doi"),
                    final_draft_data.get("conceptrecid"),
                    final_metadata.get("version"),  # Use the final, corrected version
                    final_metadata.get("title"),
                    json.dumps(final_draft_data),  # Store the final, corrected metadata
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            new_local_record_id = cursor.lastrowid

        return {"success": True, "new_local_record_id": new_local_record_id, "zenodo_response": final_draft_data}

    except Exception as e:
        logger.error(f"Failed to create new version for concept ID {concept_rec_id}: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()


@zenodo_bp.route("/zenodo/records/latest_files/<concept_rec_id>", methods=["GET"])
@project_required
def get_latest_version_files(concept_rec_id):
    """
    Finds the latest published version of a record by its concept ID and returns its file list.
    """
    is_sandbox = request.args.get("is_sandbox", "true").lower() == "true"
    try:
        latest_version_record = query_db(
            project_manager.db_path,
            """
            SELECT record_metadata_json FROM zenodo_records
            WHERE concept_rec_id = ? AND record_status = 'published' AND is_sandbox = ?
            ORDER BY version DESC LIMIT 1
            """,
            (concept_rec_id, 1 if is_sandbox else 0),
        )
        if not latest_version_record:
            return jsonify({"error": "No published record found for this concept."}), 404

        metadata = json.loads(latest_version_record[0]["record_metadata_json"])
        files = metadata.get("files", [])
        return jsonify(files)

    except Exception as e:
        logger.error(f"Failed to get files for concept {concept_rec_id}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
