# server_app/routes/operability.py
from flask import Blueprint, jsonify

from ..services.project_manager import project_manager

from ..legacy import tests as operability_tests_module

operability_bp = Blueprint("operability_bp", __name__)


@operability_bp.route("/operability/tests", methods=["GET"])
def get_operability_tests():
    """Returns the full list of implemented operability tests."""
    # This list can be hardcoded as it defines the available tests in the system.
    defined_tests = [
        {"id": "test_zenodo_live_api", "name": "Zenodo Production API Key"},
        {"id": "test_zenodo_sandbox_api", "name": "Zenodo Sandbox API Key"},
        {"id": "test_database_access", "name": "Database Access (from config)"},
        {"id": "test_object_detection_model", "name": "Object Detection Model"},
        {"id": "test_segmentation_model", "name": "Image Segmentation Model"},
        {"id": "test_geonames_api", "name": "GeoNames API"},
        {"id": "test_nominatim_api", "name": "Nominatim API"},
        {"id": "test_overpass_api", "name": "OSM Overpass API"},
        {"id": "test_ollama_llm", "name": "Local/Remote LLM (Ollama)"},
        {"id": "test_prompts_file", "name": "Validate Prompts File"},
        {"id": "test_db_integrity_check", "name": "HDPC DB Integrity (if loaded)"},
    ]
    return jsonify(defined_tests)


@operability_bp.route("/operability/run/<test_id>", methods=["POST"])
def run_operability_test(test_id):
    """Runs a specific operability test based on its ID."""
    result = {}

    # Map test_id to the actual test functions in the tests module.
    # The tests module itself will handle fetching app config via Flask's `current_app`.
    test_function_map = {
        "test_zenodo_live_api": operability_tests_module.run_test_zenodo_live_api,
        "test_zenodo_sandbox_api": operability_tests_module.run_test_zenodo_sandbox_api,
        "test_database_access": operability_tests_module.run_test_database_access,
        "test_object_detection_model": operability_tests_module.run_test_object_detection_model,
        "test_segmentation_model": operability_tests_module.run_test_segmentation_model,
        "test_geonames_api": operability_tests_module.run_test_geonames_access,
        "test_nominatim_api": operability_tests_module.run_test_nominatim_access,
        "test_overpass_api": operability_tests_module.run_test_overpass_api,
        "test_ollama_llm": operability_tests_module.run_test_ollama_llm,
        "test_prompts_file": operability_tests_module.run_test_prompts_file,
    }

    if test_id in test_function_map:
        result = test_function_map[test_id]()
    elif test_id == "test_db_integrity_check":
        if not project_manager.is_loaded:
            return jsonify({"status": "failure", "message": "No HDPC database loaded to test."})
        # Pass the db_path from the project manager to the test function.
        result = operability_tests_module.check_hdpc_db_integrity(project_manager.db_path)
    else:
        return jsonify({"status": "failure", "message": f"Unknown test ID: {test_id}"}), 404

    return jsonify(result)
