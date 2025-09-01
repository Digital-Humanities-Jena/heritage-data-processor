# server_app/routes/project.py
import json
from flask import Blueprint, request, jsonify, current_app
from pathlib import Path
from datetime import datetime, timezone
import logging
import sqlite3
import traceback

from ..utils.decorators import project_required
from ..utils.file_helpers import calculate_file_hash, get_file_mime_type
from ..utils.model_file_scanner import find_associated_files
from ..utils.file_validator import FileValidator
from ..services.project_manager import project_manager
from ..services.database import get_db_connection, query_db, load_project_config_value, execute_db
from .zenodo import _extract_and_prepare_metadata

from ..legacy.refactored_cli import (
    create_hdpc_database,
    prepare_zenodo_metadata,
    store_metadata_for_file,
    validate_zenodo_metadata,
    _save_project_config_value,
)

project_bp = Blueprint("project_bp", __name__)
logger = logging.getLogger(__name__)


@project_bp.before_request
def check_project_loaded():
    # This function can be used to protect routes that require a project to be loaded
    # For now, each route handles it explicitly for clarity.
    pass


@project_bp.route("/hdpc/load", methods=["POST"])
def load_hdpc_db():
    data = request.get_json()
    path_from_request = data.get("path")
    if not path_from_request:
        return jsonify({"error": "Path not provided"}), 400

    if project_manager.load_project(path_from_request):
        project_info = query_db(project_manager.db_path, "SELECT project_id, project_name FROM project_info LIMIT 1;")

        if project_info:
            project_id = project_info[0]["project_id"]
            project_name = project_info[0]["project_name"]
        else:
            # Fallback in case the project_info table is empty
            project_id = None
            project_name = "Unknown Project"

        return (
            jsonify(
                {
                    "message": "HDPC loaded successfully",
                    "project_name": project_name,
                    "project_id": project_id,
                }
            ),
            200,
        )
    else:
        return jsonify({"error": "Failed to load HDPC DB. File might be invalid or not found."}), 500


@project_bp.route("/project_info", methods=["GET"])
def get_project_info_route():
    if not project_manager.is_loaded:
        return jsonify({"error": "No HDPC loaded"}), 400

    data = query_db(
        project_manager.db_path,
        "SELECT project_id, project_name, description, hdpc_schema_version FROM project_info LIMIT 1;",
    )
    return jsonify(data[0] if data else {}), 200


@project_bp.route("/project_details_with_modality", methods=["GET"])
def get_project_details_with_modality_route():
    if not project_manager.is_loaded:
        return jsonify({"error": "No HDPC loaded"}), 400

    project_info_data = query_db(
        project_manager.db_path,
        "SELECT project_id, project_name, description, hdpc_schema_version FROM project_info LIMIT 1;",
    )
    if not project_info_data:
        return jsonify({"error": "Could not retrieve project info"}), 500

    project_details = project_info_data[0]
    project_id = project_details.get("project_id")
    modality = load_project_config_value(project_manager.db_path, project_id, "core.modality")
    project_details["modality"] = modality if modality else "Not Set"

    return jsonify(project_details), 200


@project_bp.route("/project/create_and_scan", methods=["POST"])
def create_and_scan_project_route():
    """
    Handles the entire new project creation process: creates the .hdpc file,
    saves all initial configuration, performs a hierarchical file scan, validates
    each file, and determines its status.
    """
    data = request.get_json()
    project_name = data.get("projectName")
    short_code = data.get("shortCode")
    hdpc_path_str = data.get("hdpcPath")
    modality = data.get("modality")
    scan_options = data.get("scanOptions")
    data_in_path_str = data.get("dataInPath")
    data_out_path_str = data.get("dataOutPath")
    batch_entity = data.get("batchEntity")

    # 1. Validate incoming data
    if not all(
        [
            project_name,
            short_code,
            hdpc_path_str,
            modality,
            scan_options,
            data_in_path_str,
            data_out_path_str,
            batch_entity,
        ]
    ):
        return jsonify({"success": False, "error": "Missing required project data for creation."}), 400

    hdpc_path = Path(hdpc_path_str)
    data_in_path = Path(data_in_path_str).resolve()

    if not data_in_path.is_dir():
        return (
            jsonify({"success": False, "error": f"The specified Input Data Directory does not exist: {data_in_path}"}),
            400,
        )

    if hdpc_path.exists():
        hdpc_path.unlink()

    # 2. Create the database from the schema file
    config_dir = Path(current_app.config["CONFIG_FILE_PATH"]).parent
    schema_path = config_dir / "hdpc_schema.yaml"
    schema_created, schema_version = create_hdpc_database(hdpc_path, schema_path)
    if not schema_created:
        return jsonify({"success": False, "error": "Failed to create the HDPC database schema from YAML."}), 500

    validator = FileValidator()
    conn = None
    try:
        # 3. Use a SINGLE connection for all subsequent operations
        conn = sqlite3.connect(hdpc_path)
        cursor = conn.cursor()
        cursor.execute("BEGIN TRANSACTION;")

        current_time_iso = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            "INSERT INTO project_info (project_name, project_short_code, hdpc_schema_version, creation_timestamp, last_modified_timestamp) VALUES (?, ?, ?, ?, ?)",
            (project_name, short_code, schema_version, current_time_iso, current_time_iso),
        )
        project_id = cursor.lastrowid

        config_values = [
            (project_id, "core.modality", modality, "Modality Template"),
            (project_id, "paths.data_in", str(data_in_path.resolve()), "Input data directory"),
            (project_id, "paths.data_out", str(Path(data_out_path_str).resolve()), "Output data directory"),
            (project_id, "core.batch_entity", batch_entity, "File processing mode"),
        ]
        cursor.executemany(
            "INSERT INTO project_configuration (project_id, config_key, config_value, description) VALUES (?, ?, ?, ?)",
            config_values,
        )
        cursor.execute(
            "INSERT INTO file_scan_settings (project_id, modality, scan_options) VALUES (?, ?, ?)",
            (project_id, modality, json.dumps(scan_options)),
        )

        # 4. Scan for files, validate, and prepare for response and DB insert
        files_added_count = 0
        extensions_to_scan = scan_options.get("extensions", [])
        found_files_for_response = []
        processed_paths = set()

        if extensions_to_scan:
            for file_p in data_in_path.rglob("*"):
                if not file_p.is_file() or str(file_p.resolve()) in processed_paths:
                    continue

                if any(file_p.name.lower().endswith(ext.lower()) for ext in extensions_to_scan):
                    if file_p.name.lower().endswith(".obj") and scan_options.get("obj_options", {}).get("add_mtl"):
                        file_structure = find_associated_files(file_p, scan_options)
                    else:
                        file_structure = {
                            "name": file_p.name,
                            "path": str(file_p.resolve()),
                            "type": "source",
                            "children": [],
                        }

                    # Validate every file in the hierarchy and set its status
                    def validate_and_set_status(file_node):
                        node_path = Path(file_node["path"])
                        validation_report = validator.validate(node_path)
                        file_node["validation_report"] = validation_report

                        is_invalid = not validation_report["is_valid"]
                        mtl_missing = False
                        textures_missing = False
                        has_conflicts = False
                        obj_options = scan_options.get("obj_options", {})

                        # Check for missing MTL (primary child) for source OBJ files
                        if (
                            file_node["type"] == "source"
                            and node_path.name.lower().endswith(".obj")
                            and obj_options.get("add_mtl")
                        ):
                            if not any(child["type"] == "primary" for child in file_node["children"]):
                                mtl_missing = True
                                validation_report["errors"].insert(
                                    0, "File Warning: The referenced MTL file was not found in the same directory."
                                )

                        if file_node["type"] == "primary" and obj_options.get("add_textures"):
                            missing_textures_list = file_node.get("missing_textures", [])
                            if missing_textures_list:
                                textures_missing = True
                                validation_report["missing_textures"] = missing_textures_list
                                error_msg = f"File Warning: Found {len(file_node['children'])} of {len(file_node['children']) + len(missing_textures_list)} referenced texture files."
                                validation_report["errors"].insert(0, error_msg)

                            conflicts_list = file_node.get("conflicts", [])
                            if conflicts_list:
                                has_conflicts = True
                                validation_report["conflicts"] = conflicts_list
                                error_msg = "File Conflict: Could not resolve texture paths due to multiple non-identical files being found."
                                validation_report["errors"].insert(0, error_msg)

                        # Set final status based on priority
                        if has_conflicts:
                            file_node["status"] = "File Conflict"
                        elif is_invalid and (mtl_missing or textures_missing):
                            file_node["status"] = "Problems"
                        elif is_invalid:
                            file_node["status"] = "Invalid"
                        elif mtl_missing:
                            file_node["status"] = "MTL Missing"
                        elif textures_missing:
                            file_node["status"] = "Textures Missing"
                        else:
                            file_node["status"] = "Valid"

                        # Recurse
                        for child in file_node.get("children", []):
                            validate_and_set_status(child)

                    validate_and_set_status(file_structure)
                    found_files_for_response.append(file_structure)

                    def insert_files_recursively(file_node, parent_id=None):
                        nonlocal files_added_count
                        node_path = Path(file_node["path"])
                        abs_path_str = str(node_path.resolve())
                        if abs_path_str in processed_paths:
                            return

                        rel_path_str = str(node_path.relative_to(data_in_path))
                        cursor.execute(
                            "INSERT INTO source_files (project_id, absolute_path, relative_path, filename, size_bytes, sha256_hash, mime_type, file_type, status, added_timestamp, parent_file_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (
                                project_id,
                                abs_path_str,
                                rel_path_str,
                                node_path.name,
                                node_path.stat().st_size,
                                calculate_file_hash(node_path),
                                get_file_mime_type(node_path),
                                file_node["type"],
                                file_node["status"],
                                datetime.now(timezone.utc).isoformat(),
                                parent_id,
                            ),
                        )
                        files_added_count += 1
                        processed_paths.add(abs_path_str)
                        new_parent_id = cursor.lastrowid
                        for child_node in file_node.get("children", []):
                            insert_files_recursively(child_node, new_parent_id)

                    insert_files_recursively(file_structure)

        conn.commit()
        return (
            jsonify(
                {
                    "success": True,
                    "message": f"Project created and {files_added_count} files scanned.",
                    "projectId": project_id,
                    "filesAdded": files_added_count,
                    "foundFiles": found_files_for_response,
                }
            ),
            201,
        )

    except Exception as e:
        if conn:
            conn.rollback()
        if hdpc_path.exists():
            hdpc_path.unlink()
        return jsonify({"success": False, "error": f"An unexpected error occurred during project creation: {e}"}), 500
    finally:
        if conn:
            conn.close()


@project_bp.route("/project/uploads_tab_counts", methods=["GET"])
def get_uploads_tab_counts_route():
    if not project_manager.is_loaded:
        return jsonify({"error": "No HDPC loaded"}), 400

    is_sandbox = request.args.get("is_sandbox", "true").lower() == "true"
    counts = {"pending_preparation": 0, "pending_operations": 0, "drafts": 0, "published": 0, "versioning": 0}
    conn = None
    try:
        conn = get_db_connection(project_manager.db_path)
        cursor = conn.cursor()
        project_id = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]

        prep_query = """SELECT COUNT(*) FROM source_files sf LEFT JOIN zenodo_records zr ON sf.file_id = zr.source_file_id WHERE sf.project_id = ? AND sf.status IN ('pending', 'source_added', 'metadata_error', 'verified', 'Valid', 'Invalid', 'Problems', 'MTL Missing', 'Textures Missing', 'File Conflict') AND (zr.record_id IS NULL OR zr.record_status IN ('preparation_failed', 'discarded'))"""
        counts["pending_preparation"] = cursor.execute(prep_query, (project_id,)).fetchone()[0]

        ops_query = """SELECT COUNT(*) FROM zenodo_records WHERE project_id = ? AND record_status = 'prepared' AND zenodo_record_id IS NULL AND is_sandbox = ?"""
        counts["pending_operations"] = cursor.execute(ops_query, (project_id, 1 if is_sandbox else 0)).fetchone()[0]

        drafts_query = """SELECT COUNT(*) FROM zenodo_records WHERE project_id = ? AND record_status = 'draft' AND zenodo_record_id IS NOT NULL AND is_sandbox = ?"""
        counts["drafts"] = cursor.execute(drafts_query, (project_id, 1 if is_sandbox else 0)).fetchone()[0]

        published_query = """SELECT COUNT(DISTINCT concept_rec_id) FROM zenodo_records WHERE project_id = ? AND record_status = 'published' AND is_sandbox = ? AND concept_rec_id IS NOT NULL"""
        counts["published"] = cursor.execute(published_query, (project_id, 1 if is_sandbox else 0)).fetchone()[0]

        counts["versioning"] = 0

        return jsonify(counts)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@project_bp.route("/project/match_files_for_versioning", methods=["POST"])
@project_required
def match_files_for_versioning_route():
    data = request.get_json()
    directory_path_str = data.get("directory_path")
    match_method = data.get("match_method", "filename")  # Default to filename

    if not directory_path_str:
        return jsonify({"success": False, "error": "Missing directory_path"}), 400

    directory_path = Path(directory_path_str)
    if not directory_path.is_dir():
        return jsonify({"success": False, "error": f"Directory not found: {directory_path_str}"}), 404

    matches = []
    try:
        with get_db_connection(project_manager.db_path) as conn:
            # Get all published records with concept_rec_id to match against
            published_records = conn.execute(
                """
                SELECT zr.concept_rec_id, zr.record_title, sf.filename, sf.sha256_hash
                FROM zenodo_records zr
                JOIN source_files sf ON zr.source_file_id = sf.file_id
                WHERE zr.record_status = 'published' AND zr.concept_rec_id IS NOT NULL
            """
            ).fetchall()

            if not published_records:
                return jsonify({"success": True, "matches": []})

            files_in_dir = [f for f in directory_path.iterdir() if f.is_file()]

            for file_path in files_in_dir:
                for record in published_records:
                    is_match = False
                    if match_method == "filename":
                        if file_path.name == record["filename"]:
                            is_match = True
                    elif match_method == "hashcode":
                        file_hash = calculate_file_hash(file_path)
                        if file_hash and file_hash == record["sha256_hash"]:
                            is_match = True

                    if is_match:
                        matches.append(
                            {
                                "concept_rec_id": record["concept_rec_id"],
                                "record_title": record["record_title"],
                                "matched_file_path": str(file_path.resolve()),
                            }
                        )
                        # Assuming one file matches one record set for simplicity
                        break

        return jsonify({"success": True, "matches": matches})

    except Exception as e:
        logger.error(f"Error matching files for versioning: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@project_bp.route("/project/preview_prepared_metadata", methods=["POST"])
def preview_prepared_metadata_route():
    """
    Performs a 'dry run' of the metadata preparation for a single file.
    """
    if not project_manager.is_loaded:
        return jsonify({"success": False, "error": "No HDPC project loaded."}), 400

    data = request.get_json()
    source_file_db_id = data.get("source_file_db_id")
    if source_file_db_id is None:
        return jsonify({"success": False, "error": "Missing source_file_db_id"}), 400

    from .zenodo import _get_metadata_from_mapping

    conn = get_db_connection(project_manager.db_path)
    try:
        project_id = conn.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]
        mapping_row = conn.execute(
            "SELECT column_definitions FROM metadata_mapping_files WHERE project_id = ? ORDER BY last_used_timestamp DESC LIMIT 1",
            (project_id,),
        ).fetchone()

        if not mapping_row:
            return jsonify({"success": False, "error": "No active metadata mapping configured."}), 404

        file_info_row = conn.execute("SELECT * FROM source_files WHERE file_id = ?", (source_file_db_id,)).fetchone()
        if not file_info_row:
            return jsonify({"success": False, "error": f"Source file with ID {source_file_db_id} not found."}), 404

        mapping_config = json.loads(mapping_row["column_definitions"])
        extracted_metadata = _get_metadata_from_mapping(dict(file_info_row), mapping_config)
        # TODO: --- Hotfix for deprecated construct_later in description. Update later.
        if isinstance(extracted_metadata.get("description"), dict) and extracted_metadata["description"].get(
            "construct_later"
        ):
            title = extracted_metadata.get("title", file_info_row["filename"])
            extracted_metadata["description"] = f"Zenodo record for the data file: {title}."
        zenodo_api_payload = prepare_zenodo_metadata(extracted_metadata)

        return jsonify(
            {"success": True, "prepared_metadata": zenodo_api_payload, "filename": file_info_row["filename"]}
        )

    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@project_bp.route("/project/source_files/add", methods=["POST"])
@project_required
def add_source_files_route():
    data = request.get_json()
    file_paths = data.get("absolute_file_paths", [])
    record_id_to_associate = data.get("record_id_to_associate")
    pipeline_name = data.get("pipeline_name")
    step_name = data.get("step_name")

    if not file_paths:
        return jsonify({"error": "Missing 'absolute_file_paths' list."}), 400

    added_count, errors_count, skipped_count = 0, 0, 0
    errors_list = []
    file_ids_to_associate = []

    conn = get_db_connection(project_manager.db_path)
    try:
        project_id = conn.execute("SELECT project_id FROM project_info LIMIT 1;").fetchone()["project_id"]

        # Get the hash of the original source file for the associated record.
        source_hash_to_ignore = None
        if record_id_to_associate:
            source_file_row = conn.execute(
                """
                SELECT sf.sha256_hash FROM source_files sf
                JOIN zenodo_records zr ON sf.file_id = zr.source_file_id
                WHERE zr.record_id = ?
                """,
                (record_id_to_associate,),
            ).fetchone()
            if source_file_row:
                source_hash_to_ignore = source_file_row["sha256_hash"]
                logger.info(
                    f"For record_id {record_id_to_associate}, the source file hash to ignore is: {source_hash_to_ignore[:10]}..."
                )

        with conn:
            cursor = conn.cursor()
            for path_str in file_paths:
                file_path = Path(path_str).resolve()
                if not file_path.is_file():
                    errors_list.append(f"Path is not a file: {path_str}")
                    errors_count += 1
                    continue

                current_file_hash = calculate_file_hash(file_path)

                # If the incoming file's content is identical to the original source file's content, skip it.
                if source_hash_to_ignore and current_file_hash == source_hash_to_ignore:
                    logger.info(
                        f"Skipping file '{file_path.name}' because its content hash matches the original source file for this record."
                    )
                    skipped_count += 1
                    continue

                # Check if this exact file path already exists in the database.
                existing = cursor.execute(
                    "SELECT file_id FROM source_files WHERE absolute_path = ?", (str(file_path),)
                ).fetchone()

                if existing:
                    skipped_count += 1
                    file_ids_to_associate.append(existing["file_id"])
                    continue

                # If the file is truly new, insert it.
                file_type = "derived" if record_id_to_associate else "source"
                status = "pending_upload" if record_id_to_associate else "pending"

                params = (
                    project_id,
                    str(file_path),
                    file_path.name,
                    file_path.name,
                    file_path.stat().st_size,
                    current_file_hash,
                    get_file_mime_type(file_path),
                    file_type,
                    status,
                    datetime.now(timezone.utc).isoformat(),
                    pipeline_name,
                    step_name,
                )
                cursor.execute(
                    """
                    INSERT INTO source_files (project_id, absolute_path, relative_path, filename, size_bytes, sha256_hash, mime_type, file_type, status, added_timestamp, pipeline_source, step_source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    params,
                )
                added_count += 1
                file_ids_to_associate.append(cursor.lastrowid)

            # Associate all valid derived files with the record.
            if record_id_to_associate and file_ids_to_associate:
                for file_id in file_ids_to_associate:
                    cursor.execute(
                        "INSERT OR IGNORE INTO record_files_map (record_id, file_id, upload_status) VALUES (?, ?, ?)",
                        (record_id_to_associate, file_id, "pending"),
                    )
    except Exception as e:
        logger.error(f"Error adding source files: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Internal server error: {e}"}), 500
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


@project_bp.route("/project/prepare_metadata_for_file", methods=["POST"])
@project_required
def prepare_metadata_for_file_route():
    data = request.get_json()
    source_file_db_id = data.get("source_file_db_id")
    target_is_sandbox = data.get("target_is_sandbox", True)
    overrides = data.get("overrides", {})
    log_messages = [f"Prepare metadata for File ID: {source_file_db_id}, Target Sandbox: {target_is_sandbox}"]

    conn = get_db_connection(project_manager.db_path)
    try:
        # Step 1: Extract all metadata using the corrected helper
        extracted_metadata, file_info, mapping_config = _extract_and_prepare_metadata(conn, source_file_db_id)
        project_id = conn.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()["project_id"]

        # Step 2: Apply any user overrides from the modal
        if overrides:
            log_messages.append(f"Applying user overrides for fields: {list(overrides.keys())}")
            extracted_metadata.update(overrides)

        # Step 3: Sanitize metadata before final preparation.
        # Remove any optional keys that have empty values (like an empty string for language).
        keys_to_remove = [key for key, value in extracted_metadata.items() if value is None or value == ""]
        if keys_to_remove:
            log_messages.append(f"Sanitizing metadata: Removing empty optional fields: {keys_to_remove}")
            for key in keys_to_remove:
                del extracted_metadata[key]

        # Step 4: Auto-construct description if needed
        if isinstance(extracted_metadata.get("description"), dict) and extracted_metadata["description"].get(
            "construct_later"
        ):
            log_messages.append("Auto-constructing description from title...")
            title = extracted_metadata.get("title", file_info["filename"])
            extracted_metadata["description"] = f"Zenodo record for the data file: {title}."

        # Step 5: Prepare, validate, and store
        zenodo_api_payload = prepare_zenodo_metadata(extracted_metadata)
        validation_errors = validate_zenodo_metadata(zenodo_api_payload)

        if validation_errors:
            log_messages.append(f"Validation failed: {validation_errors}")
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

        log_messages.append("Metadata validated successfully.")
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
        log_messages.append("Metadata stored and record status set to 'prepared'.")
        return jsonify(
            {"success": True, "message": "Metadata prepared and validated successfully.", "log": log_messages}
        )

    except Exception as e:
        logger.error(f"Error preparing metadata: {e}", exc_info=True)
        log_messages.append(f"An unexpected error occurred: {e}")
        return jsonify({"success": False, "error": str(e), "log": log_messages}), 500
    finally:
        if conn:
            conn.close()


@project_bp.route("/project/update_description", methods=["POST"])
@project_required
def update_project_description():
    data = request.get_json()
    new_description = data.get("description")
    if new_description is None:
        return jsonify({"success": False, "error": "Missing 'description' in request."}), 400

    try:
        success = execute_db(
            project_manager.db_path,
            "UPDATE project_info SET description = ? WHERE project_id = (SELECT project_id FROM project_info LIMIT 1)",
            (new_description,),
        )
        if success:
            return jsonify({"success": True, "message": "Project description updated successfully."})
        else:
            return jsonify({"success": False, "error": "Database operation failed."}), 500
    except Exception as e:
        logger.error(f"Error updating project description: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@project_bp.route("/project/dashboard_stats", methods=["GET"])
@project_required
def get_dashboard_stats():
    try:
        # Get counts for drafts and published records for both sandbox and production
        drafts_sandbox = query_db(
            project_manager.db_path,
            "SELECT COUNT(*) as count FROM zenodo_records WHERE record_status = 'draft' AND is_sandbox = 1",
        )[0]["count"]
        published_sandbox = query_db(
            project_manager.db_path,
            "SELECT COUNT(*) as count FROM zenodo_records WHERE record_status = 'published' AND is_sandbox = 1",
        )[0]["count"]

        drafts_production = query_db(
            project_manager.db_path,
            "SELECT COUNT(*) as count FROM zenodo_records WHERE record_status = 'draft' AND is_sandbox = 0",
        )[0]["count"]
        published_production = query_db(
            project_manager.db_path,
            "SELECT COUNT(*) as count FROM zenodo_records WHERE record_status = 'published' AND is_sandbox = 0",
        )[0]["count"]

        # Get other useful stats
        total_files = query_db(project_manager.db_path, "SELECT COUNT(*) as count FROM source_files")[0]["count"]
        files_with_metadata = query_db(
            project_manager.db_path, "SELECT COUNT(DISTINCT source_file_id) as count FROM metadata_values"
        )[0]["count"]

        stats = {
            "drafts_sandbox": drafts_sandbox,
            "published_sandbox": published_sandbox,
            "drafts_production": drafts_production,
            "published_production": published_production,
            "total_files": total_files,
            "files_with_metadata": files_with_metadata,
        }
        return jsonify(stats)
    except Exception as e:
        logger.error(f"Error fetching dashboard stats: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@project_bp.route("/project/update_title", methods=["POST"])
@project_required
def update_project_title():
    data = request.get_json()
    new_title = data.get("title")
    if not new_title:
        return jsonify({"success": False, "error": "A project title cannot be empty."}), 400

    try:
        success = execute_db(
            project_manager.db_path,
            "UPDATE project_info SET project_name = ? WHERE project_id = (SELECT project_id FROM project_info LIMIT 1)",
            (new_title,),
        )
        if success:
            return jsonify({"success": True, "message": "Project title updated successfully."})
        else:
            return jsonify({"success": False, "error": "Database operation failed."}), 500
    except Exception as e:
        logger.error(f"Error updating project title: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@project_bp.route("/project/published_records", methods=["GET"])
@project_required
def get_published_records():
    try:
        # Correctly query the 10 most recent published records using the new schema
        published_records = query_db(
            project_manager.db_path,
            "SELECT record_title, zenodo_doi, zenodo_record_id, last_updated_timestamp as publication_date FROM zenodo_records WHERE record_status = 'published' ORDER BY last_updated_timestamp DESC LIMIT 10",
        )
        return jsonify(published_records)
    except Exception as e:
        logger.error(f"Error fetching published records: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
