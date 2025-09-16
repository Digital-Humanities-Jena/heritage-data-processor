# server_app/legacy/refactored_cli.py
from datetime import datetime
import json
from pathlib import Path
import re
import requests
import sqlite3
import sys
import traceback
from typing import Any, Optional, List, Dict, Union, Tuple
import yaml


def _save_project_config_value(
    hdpc_path: Path, project_id: int, key: str, value: Any, description: Optional[str] = None
) -> bool:
    """
    Saves a key-value pair into the project_configuration table of the .hdpc project file.
    project_id is now an explicit parameter.
    Value is stored as a JSON string if it's a dict or list, otherwise as text.
    """
    conn = None
    try:
        conn = sqlite3.connect(hdpc_path)
        cursor = conn.cursor()

        # Serialize dicts/lists to JSON strings for storage
        if isinstance(value, (dict, list)):
            value_to_store = json.dumps(value)
        else:
            value_to_store = str(value)  # Ensure it's a string

        cursor.execute(
            """
            INSERT OR REPLACE INTO project_configuration (project_id, config_key, config_value, description)
            VALUES (?, ?, ?, ?);
            """,
            (project_id, key, value_to_store, description),  # Use the passed project_id
        )
        conn.commit()
        print(
            f"   💾 Project config saved: {key} = {str(value_to_store)[:70]}{'...' if len(str(value_to_store)) > 70 else ''}"
        )
        return True
    except sqlite3.Error as e:
        print(f"❌ Database Error saving project configuration for project ID {project_id}, key '{key}': {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error saving project configuration for project ID {project_id}, key '{key}': {e}")
        return False
    finally:
        if conn:
            conn.close()


# Placeholder for rate_limiter if not globally available in the module:
class MockRateLimiter:
    def wait_for_rate_limit(self):
        pass

    def record_request(self):
        pass


# rate_limiter_zenodo = MockRateLimiter() # Will be uncommented after real one is ready


# Placeholder for logger:
class MockLogger:
    def info(self, msg):
        print(f"INFO: {msg}")

    def error(self, msg):
        print(f"ERROR: {msg}", file=sys.stderr)


# logger = MockLogger() # Will be uncommented after real one is ready


def publish_record_cli(
    record_data_from_db: sqlite3.Row,
    conn: sqlite3.Connection,  # HDPC DB connection, used for logging and potentially updates
    conn_params: Dict[str, str],  # API access token
    base_url: str,
) -> Tuple[Dict[str, Union[bool, int, str, List[str]]], Dict[str, Any]]:
    return_msg = {"success": False, "response_initial_status": 0, "response_initial_text": "", "errors": []}
    api_response_data = {}  # This will hold the Zenodo API response

    local_db_record_id = None
    log_source_file_id = None  # For logging into api_log table

    try:
        # --- Robust Key Access for essential IDs ---
        if "record_id" not in record_data_from_db.keys():
            raise ValueError("Critical: 'record_id' column missing from input database row.")
        local_db_record_id = record_data_from_db["record_id"]

        if "source_file_id" in record_data_from_db.keys():
            log_source_file_id = record_data_from_db["source_file_id"]
        else:
            # This indicates a schema mismatch if 'source_file_id' is expected for all zenodo_records
            print(
                f"Warning: 'source_file_id' column missing for record_id {local_db_record_id}. API log will lack file_id.",
                file=sys.stderr,
            )

        if "record_metadata_json" not in record_data_from_db.keys():
            error_detail = (
                f"Column 'record_metadata_json' not found in fetched 'zenodo_records' row (DB ID: {local_db_record_id}). "
                f"Available columns: {list(record_data_from_db.keys())}. Check HDPC DB schema."
            )
            return_msg["errors"].append(error_detail)
            return_msg["response_initial_text"] = error_detail
            # logger.error(error_detail)
            print(f"ERROR: {error_detail}", file=sys.stderr)
            return return_msg, api_response_data

        draft_api_response_json_str = record_data_from_db["record_metadata_json"]
        if not draft_api_response_json_str:
            raise ValueError(f"Stored 'record_metadata_json' for draft (DB ID: {local_db_record_id}) is empty.")

        draft_api_response = json.loads(draft_api_response_json_str)
        publish_link = draft_api_response.get("links", {}).get("publish")
        deposition_id_for_recheck = draft_api_response.get("id")  # This is the Zenodo deposition ID

        if not publish_link:
            error_msg = "Could not find the 'publish' action link in the draft's metadata from Zenodo."
            return_msg["errors"].append(error_msg)
            return_msg["response_initial_text"] = error_msg
            # logger.warning(f"Publish link missing for record_id {local_db_record_id}")
            print(f"WARNING: {error_msg} for record_id {local_db_record_id}", file=sys.stderr)
            return return_msg, draft_api_response  # Return current draft if link is missing

        # Fetch project_id for logging, ensure cursor uses the passed 'conn'
        cursor = conn.cursor()  # Use the main HDPC DB connection passed to this function
        project_id_row = cursor.execute("SELECT project_id FROM project_info LIMIT 1").fetchone()
        project_id_for_log = project_id_row[0] if project_id_row else -1  # Fallback for logging

        # --- Perform Publish API Call ---
        # TODO: Set correct Rate Limiter
        # rate_limiter_zenodo.wait_for_rate_limit()
        r_publish = requests.post(publish_link, params=conn_params, timeout=120)
        # rate_limiter_zenodo.record_request()

        return_msg["response_initial_status"] = r_publish.status_code
        try:
            initial_api_response_data = r_publish.json()
            return_msg["response_initial_text"] = json.dumps(initial_api_response_data)
        except json.JSONDecodeError:
            initial_api_response_data = {"raw_response_text": r_publish.text}
            return_msg["response_initial_text"] = r_publish.text

        api_response_data = initial_api_response_data  # Default to this, may be updated by re-check
        log_db_status = "error"  # For api_log table

        if r_publish.status_code == 202:  # Accepted: Publish request submitted
            return_msg["success"] = True
            log_db_status = "success"
            # api_response_data (initial_api_response_data) contains the PUBLISHED record details
            # logger.info(f"Successfully published Zenodo record (local ID {local_db_record_id}, Zenodo ID {api_response_data.get('id')})")
            print(
                f"INFO: Successfully published Zenodo record (local ID {local_db_record_id}, Zenodo ID {api_response_data.get('id')})"
            )

            # Update local DB
            cursor.execute(
                """
                UPDATE zenodo_records
                SET record_status = 'published',
                    zenodo_doi = ?, 
                    concept_doi = ?, 
                    record_metadata_json = ?, /* Store published metadata */
                    last_publish_api_response = ?, 
                    last_api_error = NULL, 
                    last_updated_timestamp = CURRENT_TIMESTAMP
                WHERE record_id = ?
                """,
                (
                    api_response_data.get("doi"),
                    api_response_data.get("conceptdoi"),  # Zenodo uses 'conceptdoi' for published records
                    json.dumps(api_response_data),  # Store the full published record response
                    json.dumps(return_msg),  # Store our structured success message
                    local_db_record_id,
                ),
            )

        # Simplified 500 error handling for brevity here, your original had more detailed re-check
        elif r_publish.status_code == 500 and deposition_id_for_recheck:
            return_msg["errors"].append("Initial publish call returned HTTP 500. Re-verification logic would go here.")
            # For now, marking as failure if re-verification isn't re-pasted
            return_msg["success"] = False
            cursor.execute(
                "UPDATE zenodo_records SET last_api_error = ?, last_updated_timestamp = CURRENT_TIMESTAMP WHERE record_id = ?",
                (json.dumps(return_msg), local_db_record_id),
            )

        else:  # Other errors
            return_msg["success"] = False
            if isinstance(api_response_data.get("errors"), list):
                return_msg["errors"].extend(
                    [str(e.get("message", e) if isinstance(e, dict) else e) for e in api_response_data["errors"]]
                )
            elif isinstance(api_response_data.get("message"), str):
                return_msg["errors"].append(api_response_data["message"])
            else:
                return_msg["errors"].append(
                    f"HTTP {r_publish.status_code}: {return_msg['response_initial_text'][:200]}..."
                )
            # logger.error(f"Failed to publish record {local_db_record_id}: {return_msg['errors']}")
            print(f"ERROR: Failed to publish record {local_db_record_id}: {return_msg['errors']}", file=sys.stderr)
            cursor.execute(
                "UPDATE zenodo_records SET last_api_error = ?, last_updated_timestamp = CURRENT_TIMESTAMP WHERE record_id = ?",
                (json.dumps(return_msg), local_db_record_id),
            )

        # Log the API call attempt to api_log table
        cursor.execute(
            """
            INSERT INTO api_log (project_id, record_id, file_id, http_method, endpoint_url, 
                                 request_body, response_status_code, response_body, status)
            VALUES (?, ?, ?, 'POST', ?, ?, ?, ?, ?)
            """,
            (
                project_id_for_log,
                local_db_record_id,
                log_source_file_id,
                publish_link,
                None,  # Request body for POST to publish link is typically empty
                r_publish.status_code,
                json.dumps(return_msg),  # Log our structured message
                log_db_status,
            ),
        )
        conn.commit()

    except ValueError as e:  # Catches custom ValueErrors, e.g., missing JSON or link
        error_msg_text = f"Data error for publishing record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"ERROR in publish_record_cli: {error_msg_text}", file=sys.stderr)
    except json.JSONDecodeError as e:
        error_msg_text = f"Failed to parse stored 'record_metadata_json' for record ID {local_db_record_id}: {e}."
        if "draft_api_response_json_str" in locals() and draft_api_response_json_str:  # Check if variable exists
            error_msg_text += f" Raw data (first 200 chars): '{draft_api_response_json_str[:200]}...'"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"ERROR in publish_record_cli: {error_msg_text}", file=sys.stderr)
    except requests.exceptions.RequestException as e:
        error_msg_text = f"Network error during publish for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"ERROR in publish_record_cli: {error_msg_text}", file=sys.stderr)
    except sqlite3.Error as e:
        error_msg_text = f"Database error during publish operation for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"ERROR in publish_record_cli: {error_msg_text}", file=sys.stderr)
        # No explicit rollback here as conn is managed by the caller route,
    except Exception as e:  # Catch-all for any other unexpected error
        error_msg_text = f"An unexpected error occurred in publish_record_cli for record ID {local_db_record_id}: {e}"
        return_msg["text"] = error_msg_text
        return_msg["errors"].append(str(e))
        print(f"ERROR in publish_record_cli: {error_msg_text}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    return return_msg, api_response_data


def create_hdpc_database(db_path: Path, schema_path: Path = Path("./hdpc_schema.yaml")) -> Tuple[bool, Optional[str]]:
    """
    Creates and initializes an SQLite database schema based on a YAML definition.
    Does NOT insert initial project-specific data like name or short_code.

    Args:
        db_path: Path where the SQLite database file should be created.
        schema_path: Path to the YAML file defining the database schema.

    Returns:
        Tuple: (success_status: bool, schema_version: Optional[str])
    """
    print(f"\n--- Initializing Project Database Schema ({db_path.name}) ---")
    conn = None
    schema_version_loaded: Optional[str] = None
    try:
        # 1. Load Schema from YAML
        print(f"Loading schema from: {schema_path}")
        if not schema_path.exists() or not schema_path.is_file():
            print(f"❌ Schema Error: Schema file not found or is not a file: {schema_path}")
            return False, None
        with open(schema_path, "r", encoding="utf-8") as f:
            schema = yaml.safe_load(f)

        if not schema or "tables" not in schema or not isinstance(schema["tables"], dict):
            print("❌ Schema Error: Invalid schema format (missing 'tables' dictionary).")
            return False, None
        if "schema_info" not in schema or "version" not in schema["schema_info"]:
            print("❌ Schema Error: Missing 'schema_info.version' in YAML file.")
            return False, None
        schema_version_loaded = str(schema["schema_info"]["version"])  # Ensure it's a string
        print(f"Using schema version: {schema_version_loaded}")

        # 2. Connect to SQLite DB (creates the file)
        print(f"Creating/Connecting to database at: {db_path}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Enable foreign keys support
        cursor.execute("PRAGMA foreign_keys = ON;")

        # 3. Create Tables based on Schema
        print("Creating database tables...")
        for table_name, table_info in schema["tables"].items():
            if "columns" not in table_info or not isinstance(table_info["columns"], list):
                print(f"⚠️ Schema Warning: Skipping table '{table_name}', invalid 'columns' definition.")
                continue

            col_defs = []
            for col in table_info["columns"]:
                if "name" not in col or "type" not in col:
                    print(f"⚠️ Schema Warning: Skipping column in '{table_name}', missing 'name' or 'type'.")
                    continue
                col_def = f"\"{col['name']}\" {col['type']}"
                if "constraints" in col and isinstance(col["constraints"], list):
                    col_def += " " + " ".join(col["constraints"])
                col_defs.append(col_def)

            # Handle table-level constraints
            if "constraints" in table_info and isinstance(table_info["constraints"], list):
                for tbl_constraint in table_info["constraints"]:
                    if "type" not in tbl_constraint:
                        print(f"⚠️ Schema Warning: Skipping constraint in '{table_name}' with missing 'type'")
                        continue

                    if tbl_constraint["type"] == "UNIQUE" and "columns" in tbl_constraint:
                        cols = '", "'.join(tbl_constraint["columns"])
                        col_defs.append(f'UNIQUE ("{cols}")')

                    elif (
                        tbl_constraint["type"] == "FOREIGN KEY"
                        and "columns" in tbl_constraint
                        and "references" in tbl_constraint
                    ):
                        cols = '", "'.join(tbl_constraint["columns"])
                        references = tbl_constraint["references"]
                        col_defs.append(f'FOREIGN KEY ("{cols}") REFERENCES {references}')

                    else:
                        print(
                            f"⚠️ Schema Warning: Unsupported constraint type in '{table_name}': {tbl_constraint['type']}"
                        )

            if not col_defs:
                print(f"⚠️ Schema Warning: No valid columns for table '{table_name}'. Skipping.")
                continue

            create_sql = f"CREATE TABLE IF NOT EXISTS \"{table_name}\" ({', '.join(col_defs)});"
            cursor.execute(create_sql)
            print(f"   - Table '{table_name}' created.")

        # 4. Create Indexes based on Schema
        print("Creating database indexes...")
        for table_name, table_info in schema["tables"].items():
            if "indexes" in table_info and isinstance(table_info["indexes"], list):
                for index in table_info["indexes"]:
                    if "name" not in index or "columns" not in index or not index["columns"]:
                        print(f"⚠️ Schema Warning: Skipping invalid index definition in '{table_name}'.")
                        continue
                    idx_name = index["name"]
                    idx_cols = '", "'.join(index["columns"])
                    is_unique = index.get("unique", False)
                    unique_str = "UNIQUE" if is_unique else ""
                    index_sql = (
                        f'CREATE {unique_str} INDEX IF NOT EXISTS "{idx_name}" ON "{table_name}" ("{idx_cols}");'
                    )
                    cursor.execute(index_sql)
                    print(f"   - Index '{idx_name}' on '{table_name}' created.")

        # 5. Create Triggers (new section)
        print("Creating database triggers...")
        for table_name, table_info in schema["tables"].items():
            if "triggers" in table_info and isinstance(table_info["triggers"], list):
                for trigger in table_info["triggers"]:
                    if "name" not in trigger or "event" not in trigger or "action" not in trigger:
                        print(f"⚠️ Schema Warning: Skipping invalid trigger definition in '{table_name}'.")
                        continue

                    trigger_name = trigger["name"]
                    event = trigger["event"]
                    action = trigger["action"]

                    # Optional trigger timing (BEFORE, AFTER, INSTEAD OF)
                    timing = event.split()[0] if len(event.split()) > 1 else "AFTER"
                    event_type = event.split()[-1]  # INSERT, UPDATE, DELETE

                    trigger_sql = (
                        f'CREATE TRIGGER IF NOT EXISTS "{trigger_name}" '
                        f'{timing} {event_type} ON "{table_name}" '
                        f"BEGIN {action} END;"
                    )

                    cursor.execute(trigger_sql)
                    print(f"   - Trigger '{trigger_name}' on '{table_name}' created.")

        conn.commit()
        print("✅ Database schema (tables, indexes, and triggers) initialized successfully.")
        return True, schema_version_loaded

    except yaml.YAMLError as e:
        print(f"❌ Error parsing schema file {schema_path}: {e}")
        return False, None
    except sqlite3.Error as e:
        print(f"❌ Database Error during schema initialization: {e}")
        return False, None
    except Exception as e:
        print(f"❌ An unexpected error occurred during database schema creation: {e}")
        return False, None
    finally:
        if conn:
            conn.close()


def prepare_zenodo_metadata(metadata_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transforms the internally generated metadata into the strict format required by the Zenodo API.
    This includes special handling for complex fields like dates, creators, and locations to ensure compliance.

    Args:
        metadata_dict: Dictionary of metadata values produced by generate_metadata_from_mapping.

    Returns:
        Dictionary formatted for the Zenodo API, suitable for creating or updating a deposition.
    """
    # Start with a clean, basic structure for the Zenodo API payload.
    zenodo_metadata = {"metadata": {}}

    # Direct-mapping fields: These have a simple key-value structure (string, number, boolean)
    direct_mapping_fields = [
        "title",
        "description",
        "access_right",
        "license",
        "version",
        "language",
        "notes",
        "journal_title",
        "journal_volume",
        "journal_issue",
        "journal_pages",
        "imprint_publisher",
        "imprint_place",
        "imprint_isbn",
        "partof_title",
        "partof_pages",
        "thesis_university",
        "conference_title",
        "conference_acronym",
        "conference_dates",
        "conference_place",
        "conference_url",
        "conference_session",
        "conference_session_part",
        "publication_date",
        "method",
    ]
    for field in direct_mapping_fields:
        if field in metadata_dict and metadata_dict[field] is not None:
            # Ensure empty strings aren't passed for required fields like title
            if field == "title" and not str(metadata_dict[field]).strip():
                continue  # Skip adding an empty or whitespace-only title
            zenodo_metadata["metadata"][field] = metadata_dict[field]

    # Handle upload_type and its dependent sub-fields
    if "upload_type" in metadata_dict and metadata_dict["upload_type"]:
        upload_type = metadata_dict["upload_type"]
        zenodo_metadata["metadata"]["upload_type"] = upload_type
        if upload_type == "publication" and "publication_type" in metadata_dict:
            zenodo_metadata["metadata"]["publication_type"] = metadata_dict["publication_type"]
        elif upload_type == "image" and "image_type" in metadata_dict:
            zenodo_metadata["metadata"]["image_type"] = metadata_dict["image_type"]
    else:
        # Provide a safe default if not specified
        zenodo_metadata["metadata"]["upload_type"] = "dataset"

    # --- Structured List Fields ---
    # These fields expect a list of strings or a list of objects.

    # Handle simple list of strings: keywords, references
    for field in ["keywords", "references"]:
        if field in metadata_dict and isinstance(metadata_dict[field], list) and metadata_dict[field]:
            # Ensure all items are strings and filter out any empty ones
            zenodo_metadata["metadata"][field] = [str(item) for item in metadata_dict[field] if str(item).strip()]

    # Handle list of objects: creators, contributors, subjects, related_identifiers, communities, grants
    for field in ["creators", "contributors", "subjects", "related_identifiers", "communities", "grants"]:
        if field in metadata_dict and isinstance(metadata_dict[field], list) and metadata_dict[field]:
            # For now, we trust generate_metadata_from_mapping created these with the correct structure.
            # More rigid validation could be added here if needed.
            zenodo_metadata["metadata"][field] = metadata_dict[field]

    # --- DATES FIELD: Special Handling for Compliance and Backward Compatibility ---
    if "dates" in metadata_dict and isinstance(metadata_dict["dates"], list):
        processed_dates: List[Dict[str, Any]] = []
        for date_entry in metadata_dict["dates"]:
            if not isinstance(date_entry, dict):
                continue  # Skip invalid entries (e.g., plain strings in the list)

            new_date_entry = date_entry.copy()

            # Backward compatibility for old "date" key from a previous mapping schema
            if "date" in new_date_entry and "start" not in new_date_entry:
                date_str = str(new_date_entry["date"]).strip()
                # Handle date ranges like "2020-01-01/2020-01-31" from a single field
                if "/" in date_str:
                    parts = date_str.split("/")
                    new_date_entry["start"] = parts[0].strip()
                    if len(parts) > 1:
                        new_date_entry["end"] = parts[1].strip()
                else:  # Handle a single date
                    new_date_entry["start"] = date_str

            # For a single date, Zenodo requires start and end to be the same if end is provided.
            # If only start is given, that's also valid. For simplicity and clarity, we set both.
            if new_date_entry.get("start") and not new_date_entry.get("end"):
                new_date_entry["end"] = new_date_entry["start"]

            # Remove the non-compliant "date" key if it exists
            if "date" in new_date_entry:
                del new_date_entry["date"]

            # Final check to ensure the object is valid before adding it to the list
            if new_date_entry.get("type") and (new_date_entry.get("start") or new_date_entry.get("end")):
                processed_dates.append(new_date_entry)

        if processed_dates:
            zenodo_metadata["metadata"]["dates"] = processed_dates

    # Handle locations (can be copied directly if format is correct)
    if "locations" in metadata_dict and isinstance(metadata_dict["locations"], list) and metadata_dict["locations"]:
        # Further validation could be added here to ensure each location dict is valid
        zenodo_metadata["metadata"]["locations"] = metadata_dict["locations"]

    # Handle prereserve_doi
    if "doi" in metadata_dict and metadata_dict["doi"]:
        zenodo_metadata["metadata"]["prereserve_doi"] = {"doi": str(metadata_dict["doi"])}

    # Final check for mandatory fields that might still be empty
    if not zenodo_metadata["metadata"].get("title"):
        zenodo_metadata["metadata"]["title"] = "Untitled"  # Provide a safe fallback
    if not zenodo_metadata["metadata"].get("description"):
        zenodo_metadata["metadata"]["description"] = "No description provided."  # Provide a safe fallback
    if not zenodo_metadata["metadata"].get("creators"):
        zenodo_metadata["metadata"]["creators"] = [{"name": "Unknown"}]  # Provide a safe fallback

    return zenodo_metadata


def store_metadata_for_file(
    conn,
    project_id: int,
    file_id: int,
    all_extracted_metadata: Dict[str, Any],  # Contains Zenodo AND custom keys from generate_metadata_from_mapping
    zenodo_api_payload: Dict[str, Any],  # Contains {"metadata": {...only Zenodo keys...}} from prepare_zenodo_metadata
    mapping: Dict[str, Any],
    target_is_sandbox_for_record: bool,
):
    """
    Stores all extracted metadata fields in metadata_values,
    and the clean Zenodo API payload in zenodo_records.
    """
    cursor = conn.cursor()

    mapping_name = mapping.get("_mapping_name", "default_project_mapping")
    cursor.execute(
        "SELECT mapping_id FROM metadata_mapping_files WHERE project_id = ? AND mapping_name = ? LIMIT 1",
        (project_id, mapping_name),
    )
    mapping_result = cursor.fetchone()
    db_mapping_id = None  # Renamed from mapping_id to avoid conflict with parameter
    if mapping_result:
        db_mapping_id = mapping_result[0]
    else:
        _file_path = mapping.get("_file_path", "N/A")
        _file_format = mapping.get("_file_format", "N/A")
        _col_defs = json.dumps(
            {k: v for k, v in mapping.items() if not k.startswith("_")}
        )  # Store actual column mappings

        cursor.execute(
            "INSERT INTO metadata_mapping_files (project_id, mapping_name, file_path, file_format, column_definitions) VALUES (?, ?, ?, ?, ?)",
            (project_id, mapping_name, _file_path, _file_format, _col_defs),
        )
        db_mapping_id = cursor.lastrowid

    cursor.execute("DELETE FROM metadata_values WHERE source_file_id = ? AND mapping_id = ?", (file_id, db_mapping_id))

    # Iterate over `all_extracted_metadata` which contains the direct output of `generate_metadata_from_mapping`
    # This includes keys like "title", "creators", AND "sublocation", "location_ai_input" etc.
    for field_name, field_value in all_extracted_metadata.items():
        if field_name.startswith("_") or field_name == "filename":
            continue  # Skip internal fields from the mapping file itself or the filename key

        value_to_store = field_value
        if isinstance(field_value, (list, dict)):
            value_to_store = json.dumps(field_value)

        if value_to_store is not None:
            try:
                cursor.execute(
                    "INSERT INTO metadata_values (source_file_id, mapping_id, field_name, field_value, extracted_timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                    (file_id, db_mapping_id, field_name, str(value_to_store)),
                )
            except sqlite3.IntegrityError:
                cursor.execute(
                    "UPDATE metadata_values SET field_value = ?, extracted_timestamp = CURRENT_TIMESTAMP WHERE source_file_id = ? AND mapping_id = ? AND field_name = ?",
                    (str(value_to_store), file_id, db_mapping_id, field_name),
                )
        else:
            cursor.execute(
                "DELETE FROM metadata_values WHERE source_file_id = ? AND mapping_id = ? AND field_name = ?",
                (file_id, db_mapping_id, field_name),
            )

    cursor.execute(
        "SELECT record_id FROM zenodo_records WHERE project_id = ? AND source_file_id = ? AND record_status = 'prepared'",
        (project_id, file_id),
    )
    existing_record = cursor.fetchone()
    db_record_id = None

    # Use the title from the clean Zenodo API payload
    zenodo_record_title = zenodo_api_payload.get("metadata", {}).get("title", f"Record for file {file_id}")
    # Get the use_sandbox setting from project_configuration
    use_sandbox_row = cursor.execute(
        "SELECT config_value FROM project_configuration WHERE config_key = 'core.use_sandbox' AND project_id = ? LIMIT 1",
        (project_id,),
    ).fetchone()
    is_sandbox_value = 1 if target_is_sandbox_for_record else 0

    if existing_record:
        db_record_id = existing_record[0]
        cursor.execute(
            """
            UPDATE zenodo_records 
            SET record_title = ?, record_metadata_json = ?, mapping_id = ?, last_updated_timestamp = CURRENT_TIMESTAMP, is_sandbox = ?
            WHERE record_id = ?
            """,
            (zenodo_record_title, json.dumps(zenodo_api_payload), db_mapping_id, is_sandbox_value, db_record_id),
        )
        # print(f"   Updated existing 'prepared' Zenodo DB record (ID: {db_record_id}) for file ID {file_id}.") # Already printed in caller
    else:
        cursor.execute(
            """
            INSERT INTO zenodo_records 
            (project_id, source_file_id, mapping_id, record_title, record_metadata_json, record_status, is_sandbox) 
            VALUES (?, ?, ?, ?, ?, 'prepared', ?)
            """,
            (
                project_id,
                file_id,
                db_mapping_id,
                zenodo_record_title,
                json.dumps(zenodo_api_payload),
                is_sandbox_value,
            ),
        )
        db_record_id = cursor.lastrowid
        # print(f"   Created new Zenodo DB record (ID: {db_record_id}) in 'prepared' state for file ID {file_id}.") # Already printed in caller

        # Link file to record if new record
        # Helper function to recursively find all children from the source_files table
        def find_all_children(current_file_id):
            """Recursively finds all descendant file IDs for a given parent file ID."""
            child_ids = []
            cursor.execute("SELECT file_id FROM source_files WHERE parent_file_id = ?", (current_file_id,))
            children = cursor.fetchall()
            for child_row in children:
                child_id = child_row[0]
                child_ids.append(child_id)
                child_ids.extend(find_all_children(child_id))  # Recurse
            return child_ids

        # Get all file IDs in the bundle (parent + all descendants)
        all_file_ids_in_bundle = [file_id] + find_all_children(file_id)

        # Filter this list to get ONLY UPLOADABLE files.
        # We exclude any file explicitly marked as 'archived_file' because it's already inside a zip archive.

        uploadable_file_ids = []
        if all_file_ids_in_bundle:
            # Create a string of placeholders like "?,?,?" for the query
            placeholders = ",".join(["?"] * len(all_file_ids_in_bundle))
            query = (
                f"SELECT file_id FROM source_files WHERE file_id IN ({placeholders}) AND file_type != 'archived_file'"
            )

            cursor.execute(query, tuple(all_file_ids_in_bundle))
            uploadable_file_rows = cursor.fetchall()
            uploadable_file_ids = [row[0] for row in uploadable_file_rows]

        # Ensure all files in the bundle are associated with the record.
        # First, clear any existing maps for this record to handle re-preparation cleanly.
        cursor.execute("DELETE FROM record_files_map WHERE record_id = ?", (db_record_id,))

        # Now, insert all files from the bundle into the map
        files_to_map_params = []
        for bundle_file_id in uploadable_file_ids:
            source_file_path_row = cursor.execute(
                "SELECT absolute_path FROM source_files WHERE file_id = ?", (bundle_file_id,)
            ).fetchone()
            file_path_to_store = source_file_path_row[0] if source_file_path_row else "N/A"

            # The original source file (parent) is 'main', all children are 'derived'
            file_purpose = "main" if bundle_file_id == file_id else "derived"

            files_to_map_params.append((db_record_id, bundle_file_id, file_path_to_store, file_purpose, "pending"))

        cursor.executemany(
            "INSERT INTO record_files_map (record_id, file_id, file_path, file_purpose, upload_status) VALUES (?, ?, ?, ?, ?)",
            files_to_map_params,
        )

    cursor.execute(
        "UPDATE source_files SET status = 'metadata_ready', error_message = NULL, last_processed_timestamp = CURRENT_TIMESTAMP WHERE file_id = ?",
        (file_id,),
    )


def validate_zenodo_metadata(zenodo_metadata: Dict[str, Dict[str, Any]]) -> List[str]:
    """
    Validates Zenodo metadata against a set of predefined rules and constraints.

    This function checks the structure, required fields, data types, and specific
    content requirements for Zenodo metadata. It performs comprehensive validation
    including checks for upload types, publication types, date formats, creator
    information, access rights, and more.

    Args:
        zenodo_metadata: The Zenodo metadata to be validated.

    Returns:
        A list of error messages. An empty list indicates no validation errors.
    """
    errors = []

    if "metadata" not in zenodo_metadata:
        errors.append("Missing required 'metadata' key")
        return errors
    metadata = zenodo_metadata["metadata"]

    required_fields = ["upload_type", "publication_date", "title", "creators", "description", "access_right"]
    for field in required_fields:
        if not metadata.get(field):
            errors.append(f"Missing required field or value for: {field}")

    valid_datatypes = {
        "upload_type": str,
        "publication_type": str,
        "image_type": str,
        "publication_date": str,
        "title": str,
        "creators": list,
        "description": str,
        "access_right": str,
        "license": str,
        "embargo_date": str,
        "access_conditions": str,
        "doi": str,
        "prereserve_doi": dict,
        "keywords": list,
        "notes": str,
        "related_identifiers": list,
        "contributors": list,
        "references": list,
        "communities": list,
        "grants": list,
        "journal_title": str,
        "journal_volume": str,
        "journal_issue": str,
        "journal_pages": str,
        "conference_title": str,
        "conference_acronym": str,
        "conference_dates": str,
        "conference_place": str,
        "conference_url": str,
        "conference_session": str,
        "conference_session_part": str,
        "imprint_publisher": str,
        "imprint_isbn": str,
        "imprint_place": str,
        "partof_title": str,
        "partof_pages": str,
        "thesis_supervisors": list,
        "thesis_university": str,
        "subjects": list,
        "version": str,
        "language": str,
        "locations": list,
        "dates": list,
        "method": str,
    }

    # Check for unknown fields
    for field in metadata:
        if field not in valid_datatypes:
            errors.append(f"Unknown field: {field}")

    # Check datatypes and structure of known fields
    for field, expected_type in valid_datatypes.items():
        if field in metadata and metadata[field] is not None:
            value = metadata[field]
            if not isinstance(value, expected_type):
                errors.append(f"'{field}' must be of type {expected_type.__name__}, but got {type(value).__name__}.")
                continue  # Skip further checks on this broken field

            if expected_type == list and value:
                # Ensure list is not empty before checking item types
                if not value:
                    continue

                is_dict_list = all(isinstance(item, dict) for item in value)
                is_str_list = all(isinstance(item, str) for item in value)

                if not is_dict_list and not is_str_list:
                    errors.append(
                        f"All items in '{field}' must be of the same type (either all strings or all dictionaries)."
                    )
                elif is_dict_list:
                    # Field-specific key validation for lists of dictionaries
                    if field in ["creators", "contributors", "thesis_supervisors"]:
                        if not all("name" in item for item in value):
                            errors.append(f"Each item in '{field}' must have a 'name' key.")
                    elif field == "related_identifiers":
                        if not all("identifier" in item and "relation" in item for item in value):
                            errors.append(f"Each item in '{field}' must have 'identifier' and 'relation' keys.")
                    elif field == "communities":
                        if not all("identifier" in item for item in value):
                            errors.append(f"Each item in '{field}' must have an 'identifier' key.")
                    elif field == "grants":
                        if not all("id" in item for item in value):
                            errors.append(f"Each item in '{field}' must have an 'id' key.")
                    elif field == "subjects":
                        if not all("term" in item for item in value):
                            errors.append(f"Each item in '{field}' must have a 'term' key.")
                    elif field == "locations":
                        if not all("place" in item for item in value):
                            errors.append(f"Each item in '{field}' must have a 'place' key.")
                    elif field == "dates":
                        if not all("type" in item and ("start" in item or "end" in item) for item in value):
                            errors.append(
                                f"Each item in '{field}' must have a 'type' key and at least a 'start' or 'end' key."
                            )

    # Validate controlled vocabularies and formats
    valid_upload_types = [
        "publication",
        "poster",
        "presentation",
        "dataset",
        "image",
        "video",
        "software",
        "lesson",
        "physicalobject",
        "other",
    ]
    if "upload_type" in metadata and metadata["upload_type"] not in valid_upload_types:
        errors.append(f"Invalid upload_type: {metadata['upload_type']}")

    if metadata.get("upload_type") == "publication" and "publication_type" not in metadata:
        errors.append("Missing publication_type for upload_type 'publication'")

    if metadata.get("upload_type") == "image" and "image_type" not in metadata:
        errors.append("Missing image_type for upload_type 'image'")

    if "publication_date" in metadata and isinstance(metadata["publication_date"], str):
        try:
            datetime.strptime(metadata["publication_date"], "%Y-%m-%d")
        except (ValueError, TypeError):
            errors.append("Invalid publication_date format. Use YYYY-MM-DD.")

    if "creators" in metadata and isinstance(metadata["creators"], list):
        for creator in metadata["creators"]:
            if isinstance(creator, dict) and "orcid" in creator and creator["orcid"]:
                if not re.match(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]$", creator["orcid"]):
                    errors.append(f"Invalid ORCID format for creator: {creator.get('name', 'N/A')}")

    valid_access_rights = ["open", "embargoed", "restricted", "closed"]
    if "access_right" in metadata and metadata["access_right"] not in valid_access_rights:
        errors.append(f"Invalid access_right: {metadata['access_right']}")

    if metadata.get("access_right") in ["open", "embargoed"] and not metadata.get("license"):
        errors.append("Missing license for open or embargoed access_right")

    if metadata.get("access_right") == "embargoed":
        if not metadata.get("embargo_date"):
            errors.append("Missing embargo_date for embargoed access_right")
        elif isinstance(metadata["embargo_date"], str):
            try:
                embargo_date = datetime.strptime(metadata["embargo_date"], "%Y-%m-%d").date()
                if embargo_date <= datetime.now().date():
                    errors.append("embargo_date must be in the future")
            except (ValueError, TypeError):
                errors.append("Invalid embargo_date format. Use YYYY-MM-DD.")

    if metadata.get("access_right") == "restricted" and not metadata.get("access_conditions"):
        errors.append("Missing access_conditions for restricted access_right")

    return errors
