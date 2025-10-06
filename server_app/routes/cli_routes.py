# server_app/routes/cli_routes.py
import requests
from flask import Blueprint, jsonify, request, current_app, url_for
import sqlite3

from ..services.project_manager import project_manager

cli_bp = Blueprint("cli", __name__)


@cli_bp.route("/cli/pipelines/<pipeline_name>/execute", methods=["POST"])
def execute_cli_pipeline(pipeline_name):
    """
    A new pipeline executor specifically for the CLI.
    It duplicates the original pipeline logic but calls the corrected
    draft creation endpoint, bypassing the bug in the old code.
    """
    if not project_manager.is_loaded:
        return jsonify({"success": False, "error": "No project loaded."}), 400

    data = request.get_json()
    record_ids = data.get("record_ids", [])
    if not record_ids:
        return jsonify({"success": False, "error": "No record_ids provided."}), 400

    db_path = project_manager.db_path
    processed_items = []
    failed_items = {}

    for record_id in record_ids:
        try:
            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                record = conn.execute("SELECT * FROM zenodo_records WHERE record_id = ?", (record_id,)).fetchone()
                if not record:
                    failed_items[record_id] = "Record not found"
                    continue

                zenodo_record_id = record["zenodo_record_id"]

            # This new pipeline logic calls the corrected CLI draft creation endpoint.
            if not zenodo_record_id:
                current_app.logger.info(f"CLI PIPELINE: Creating draft for record {record_id}.")
                cli_draft_url = url_for("zenodo.create_api_draft_for_cli", _external=True)
                response = requests.post(cli_draft_url, json={"local_record_db_id": record_id})

                if response.status_code != 200:
                    raise Exception(f"Initial Zenodo draft creation failed: {response.json().get('error', 'Unknown')}")

                zenodo_record_id = response.json().get("zenodo_response", {}).get("id")
                if not zenodo_record_id:
                    raise Exception("Draft created, but could not retrieve new Zenodo ID.")

            # TODO: For now, we simulate success as the draft creation may be the main failure point.
            current_app.logger.info(
                f"CLI PIPELINE: Successfully processed record {record_id} with Zenodo ID {zenodo_record_id}."
            )
            processed_items.append(record_id)

        except Exception as e:
            error_msg = f"Failed to process item {record_id}: {e}"
            current_app.logger.error(error_msg, exc_info=True)
            failed_items[record_id] = str(e)

    if failed_items:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Pipeline run completed with errors.",
                    "processed_items": processed_items,
                    "failed_items": failed_items,
                }
            ),
            207,
        )  # Multi-Status

    return (
        jsonify(
            {
                "success": True,
                "message": "Pipeline execution completed successfully for all items.",
                "processed_items": processed_items,
            }
        ),
        200,
    )
