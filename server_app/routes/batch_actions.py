# server_app/routes/batch_actions.py
from flask import Blueprint, request, jsonify, current_app
import requests

from ..services.database import get_db_connection
from ..services.project_manager import project_manager
from .zenodo import create_api_draft_for_prepared_record, prepare_metadata_for_file_route

batch_actions_bp = Blueprint("batch_actions_bp", __name__)


@batch_actions_bp.route("/project/batch_action", methods=["POST"])
def batch_action_route():
    if not project_manager.is_loaded:
        return jsonify({"success": False, "error": "No HDPC project loaded."}), 400

    data = request.get_json()
    action_type = data.get("action_type")
    item_ids = data.get("item_ids", [])
    target_is_sandbox = data.get("target_is_sandbox", True)

    if not action_type or not item_ids:
        return jsonify({"success": False, "error": "Missing parameters for batch action."}), 400

    results = []
    overall_success = True
    server_port = current_app.config.get("SERVER_PORT", 5001)

    for item_id in item_ids:
        item_result = {"id": item_id, "success": False, "message": "Action not executed"}
        try:
            if action_type == "prepare_metadata":
                with current_app.test_request_context(
                    json={"source_file_db_id": item_id, "target_is_sandbox": target_is_sandbox}
                ):
                    response = prepare_metadata_for_file_route()
                    response_obj = response[0] if isinstance(response, tuple) else response
                    response_data = response_obj.get_json()
                    item_result.update(response_data)
                    if not response_data.get("success"):
                        if "error" not in response_data and "validation_errors" in response_data:
                            item_result["error"] = "Metadata validation failed."

            elif action_type == "create_api_draft":
                with current_app.test_request_context(json={"local_record_db_id": item_id}):
                    response = create_api_draft_for_prepared_record()
                    response_obj = response[0] if isinstance(response, tuple) else response
                    response_data = response_obj.get_json()
                    item_result.update(response_data)

            elif action_type == "remove_files":
                try:
                    with get_db_connection(project_manager.db_path) as conn:
                        cursor = conn.cursor()
                        cursor.execute("PRAGMA foreign_keys = ON;")
                        cursor.execute("DELETE FROM source_files WHERE file_id = ?", (item_id,))
                        conn.commit()
                    item_result["success"] = True
                    item_result["message"] = f"File with ID {item_id} was successfully removed."
                except Exception as db_error:
                    item_result["success"] = False
                    item_result["error"] = f"Database error removing file ID {item_id}: {db_error}"

            elif action_type == "discard_drafts":
                response = requests.post(
                    f"http://localhost:{server_port}/api/project/discard_zenodo_draft",
                    json={"local_record_db_id": item_id},
                    timeout=60,
                )
                item_result.update(response.json())

            elif action_type == "upload_main_files":
                with get_db_connection(project_manager.db_path) as conn:
                    main_sf_id_row = conn.execute(
                        "SELECT source_file_id FROM zenodo_records WHERE record_id = ?", (item_id,)
                    ).fetchone()
                if main_sf_id_row:
                    source_file_id = main_sf_id_row[0]
                    response = requests.post(
                        f"http://localhost:{server_port}/api/project/upload_file_to_deposition",
                        json={"local_record_db_id": item_id, "source_file_db_id": source_file_id},
                        timeout=300,
                    )
                    item_result.update(response.json())
                else:
                    item_result["error"] = "Could not find associated source file for this record."

            else:
                item_result["message"] = f"Unknown batch action type: {action_type}"

            if not item_result.get("success"):
                overall_success = False
        except Exception as e:
            item_result["error"] = str(e)
            overall_success = False
        results.append(item_result)

    return jsonify({"success": overall_success, "results": results})
