# server_app/legacy/metadata_processor.py
from datetime import datetime
import json
import re
import sqlite3
from typing import Any, Dict, List


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

        # Link file to record if new record
        cursor.execute(
            "SELECT map_id FROM record_files_map WHERE record_id = ? AND file_id = ?", (db_record_id, file_id)
        )
        if not cursor.fetchone():
            source_file_path = cursor.execute(
                "SELECT absolute_path FROM source_files WHERE file_id = ?", (file_id,)
            ).fetchone()
            file_path_to_store = source_file_path[0] if source_file_path else "N/A"
            cursor.execute(
                "INSERT INTO record_files_map (record_id, file_id, file_path, file_purpose, upload_status) VALUES (?, ?, ?, 'main', 'pending')",
                (db_record_id, file_id, file_path_to_store),
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
