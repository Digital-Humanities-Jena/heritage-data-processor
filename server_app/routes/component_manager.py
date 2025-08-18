# server_app/routes/component_manager.py
import json
import logging
from datetime import datetime
from pathlib import Path
from queue import Queue
import yaml
import sqlite3
import threading
import time
from typing import Any, Dict
import uuid

from flask import Blueprint, jsonify, request, Response

from ..legacy.component_config_loader import ComponentConfigLoader

from ..legacy.component_discovery import ComponentDiscovery
from ..legacy.component_installer import (
    install_component,
    uninstall_component,
)
from ..legacy.component_manager import ComponentEnvironmentManager, ComponentInstallationError

from ..services.database import execute_db
from ..services.project_manager import project_manager
from ..utils.file_helpers import smart_copy_file

component_manager_bp = Blueprint("component_manager_bp", __name__)
logger = logging.getLogger(__name__)

# Define module-level constants for component management
COMPONENTS_DIR = Path("pipeline_components")
DB_PATH = Path("databases") / "component_registry.db"


class ComponentInstallationService:
    """Manages the state and execution of component installations."""

    def __init__(self):
        self._running_installations: Dict[str, Dict[str, Any]] = {}

    def get_installation_queue(self, installation_id: str) -> Queue | None:
        install = self._running_installations.get(installation_id)
        return install.get("log_queue") if install else None

    def start_installation(self, component_name: str, file_paths: dict) -> str:
        """Registers a new installation and starts it in a background thread."""
        installation_id = str(uuid.uuid4())
        log_queue = Queue()

        self._running_installations[installation_id] = {
            "component_name": component_name,
            "log_queue": log_queue,
            "status": "starting",
            "start_time": time.time(),
        }

        thread = threading.Thread(
            target=self._installation_thread, args=(installation_id, component_name, file_paths, log_queue)
        )
        thread.daemon = True
        thread.start()
        return installation_id

    def _installation_thread(self, installation_id: str, component_name: str, file_paths: dict, log_queue: Queue):
        """The private method that runs in a thread to perform the installation."""
        try:
            manager = get_component_manager()
            component_path = COMPONENTS_DIR / component_name

            # --- Step 1: File Preparation ---
            log_queue.put({"level": "info", "message": "Preparing required files...", "progress": 5})

            models_dir = component_path / "models"
            models_dir.mkdir(exist_ok=True)
            for name, path_str in file_paths.items():
                if not path_str:
                    continue
                source_path = Path(path_str).resolve()
                dest_path = (models_dir / source_path.name).resolve()
                copy_result = smart_copy_file(source_path, dest_path)
                if not copy_result["success"]:
                    raise ComponentInstallationError(f"Failed to copy file for {name}: {copy_result['error']}")

            # --- Step 2: Run the actual installation from component_manager ---
            # This streams its output to the queue
            success = manager.install_component(component_name, log_queue=log_queue)

            # --- Step 3: Finalize ---
            if success:
                log_queue.put(
                    {
                        "level": "success",
                        "message": "✅ Installation completed successfully!",
                        "progress": 100,
                        "status": "completed",
                    }
                )
            else:
                # The install_component method will have already put the error details in the queue
                log_queue.put(
                    {
                        "level": "error",
                        "message": "❌ Installation failed. See logs above for details.",
                        "status": "failed",
                    }
                )

        except Exception as e:
            logger.error(f"Installation thread error for {installation_id}: {e}", exc_info=True)
            log_queue.put({"level": "error", "message": f"💥 A critical error occurred: {e}", "status": "failed"})
        finally:
            # Clean up the record of the running installation after a short delay
            time.sleep(10)
            if installation_id in self._running_installations:
                del self._running_installations[installation_id]


installation_service = ComponentInstallationService()


@component_manager_bp.route("/pipeline_components/<component_name>/install", methods=["POST"])
def install_component_route(component_name):
    """
    Initiates a component installation as a background task and returns an ID for log streaming.
    """
    try:
        data = request.get_json()
        file_paths = data.get("file_paths", {})

        # Start the installation and get an ID
        installation_id = installation_service.start_installation(component_name, file_paths)

        return (
            jsonify({"success": True, "message": "Installation started.", "installation_id": installation_id}),
            202,
        )  # 202 Accepted
    except Exception as e:
        logger.error(f"Failed to start installation for {component_name}: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Failed to start installation: {e}"}), 500


@component_manager_bp.route("/pipeline_components/install/stream/<installation_id>")
def stream_installation_logs(installation_id):
    """Streams installation logs for a given installation ID using Server-Sent Events."""

    def generate_logs():
        log_queue = installation_service.get_installation_queue(installation_id)
        if not log_queue:
            yield f"data: {json.dumps({'level': 'error', 'message': 'Installation job not found.'})}\n\n"
            return

        while True:
            try:
                log_message = log_queue.get(timeout=60)  # Increased timeout
                yield f"data: {json.dumps(log_message)}\n\n"
                if log_message.get("status") in ["completed", "failed"]:
                    break
            except Exception:
                # This acts as a heartbeat and also the exit condition if the job is gone
                if not installation_service.get_installation_queue(installation_id):
                    break
                yield ": heartbeat\n\n"

    return Response(generate_logs(), mimetype="text/event-stream")


# Helper Functions
def get_component_manager():
    """Get component manager instance."""
    return ComponentEnvironmentManager(COMPONENTS_DIR, DB_PATH, use_shared_deps=True)


def get_component_discovery():
    """Get component discovery instance."""
    manager = get_component_manager()
    return ComponentDiscovery(COMPONENTS_DIR, manager)


def get_component_installation_config(component_name):
    """Retrieve installation configuration for a component."""
    try:
        manager = get_component_manager()
        with sqlite3.connect(manager.db_path) as conn:
            cursor = conn.cursor()
            # Try to get from component_configurations table first
            cursor.execute(
                """
                SELECT parameters FROM component_configurations
                WHERE component_name = ? AND config_type = 'installation'
                ORDER BY updated_at DESC LIMIT 1
                """,
                (component_name,),
            )
            result = cursor.fetchone()
            if result and result[0]:
                # Directly return the loaded JSON configuration
                return json.loads(result[0])
    except Exception as e:
        logger.warning(f"Could not retrieve installation config for {component_name}: {e}")
    # Return an empty dictionary if no config is found or an error occurs
    return {}


def merge_installation_config_with_defaults(component_spec, component_name):
    """Merge stored installation configuration with default component parameters."""
    stored_config = get_component_installation_config(component_name)
    stored_file_paths = stored_config.get("file_paths", {})

    if not stored_file_paths:
        return component_spec

    merged_spec = component_spec.copy()
    if "params" in merged_spec:
        for param in merged_spec["params"]:
            param_name = param.get("name")
            if param_name in stored_file_paths:
                param["default"] = stored_file_paths[param_name]
                param["installation_provided"] = True
    return merged_spec


# API Routes
@component_manager_bp.route("/pipeline_components", methods=["GET"])
def get_pipeline_components():
    """Discover and return all available and installed pipeline components,
    correctly categorized and with their installation status."""
    try:
        discovery = get_component_discovery()

        # Use get_components_by_category to get components grouped by their actual category
        components_by_category = discovery.get_components_by_category()

        total_installed = 0
        total_available = 0

        # Iterate through the components to set the 'status' field required by the frontend
        # and to calculate the metadata stats.
        for category in components_by_category:
            for component in components_by_category[category]:
                if component.get("is_installed"):
                    component["status"] = "installed"
                    total_installed += 1
                else:
                    component["status"] = "available"
                    total_available += 1

        # Add metadata for the frontend header
        components_by_category["metadata"] = {
            "total_installed": total_installed,
            "total_available": total_available,
        }

        return jsonify(components_by_category)

    except Exception as e:
        logger.error(f"Error loading pipeline components: {e}", exc_info=True)
        return jsonify({"error": f"Failed to load components: {str(e)}"}), 500


@component_manager_bp.route("/pipeline_components/<component_name>/install", methods=["POST"])
def install_component_with_requirements(component_name):
    """Install component with configuration and file requirements."""
    # --- Validation of Component Name Congruence ---
    try:
        component_path = COMPONENTS_DIR / component_name
        if not component_path.is_dir():
            return jsonify({"success": False, "error": f"Component directory not found: {component_name}"}), 404

        yaml_path = component_path / "component.yaml"
        if not yaml_path.exists():
            return jsonify({"success": False, "error": "component.yaml not found in the component directory."}), 500

        with open(yaml_path, "r") as f:
            component_config = yaml.safe_load(f)
            name_in_yaml = component_config.get("name")

        if name_in_yaml != component_name:
            error_message = (
                f"Fatal component mismatch detected.\n\n"
                f"The component's directory is named: '{component_name}'\n"
                f"But its 'component.yaml' file specifies the name: '{name_in_yaml}'\n\n"
                f"Please correct the 'name' field in the YAML file to match the directory name to proceed with installation."
            )
            # Return a specific error payload that the frontend can display
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Component name mismatch",
                        "logs": [{"level": "error", "message": error_message}],
                    }
                ),
                400,
            )

    except Exception as validation_error:
        logger.error(f"Pre-installation validation failed for {component_name}: {validation_error}", exc_info=True)
        return (
            jsonify(
                {
                    "success": False,
                    "error": f"An error occurred during pre-installation validation: {validation_error}",
                }
            ),
            500,
        )

    try:
        data = request.get_json()
        file_paths = data.get("file_paths", {})
        installation_requirements = data.get("installation_requirements", {})

        component_path = COMPONENTS_DIR / component_name
        if not component_path.exists():
            return jsonify({"error": f"Component directory not found: {component_path}"}), 404

        manager = get_component_manager()
        if manager.is_component_installed(component_name):
            return jsonify({"success": True, "message": "Component is already installed", "already_installed": True})

        # Validate required files
        missing_files = []
        for file_req in installation_requirements.get("required_files", []):
            if file_req.get("required", True) and file_req["name"] not in file_paths:
                missing_files.append(file_req["label"])
        if missing_files:
            return jsonify({"error": f"Required files missing: {', '.join(missing_files)}"}), 400

        # Prepare and copy files
        copied_files = {}
        models_dir = component_path / "models"
        models_dir.mkdir(exist_ok=True)
        for name, path_str in file_paths.items():
            if not path_str:
                continue
            source_path = Path(path_str).resolve()
            if source_path.exists():
                dest_filename = next(
                    (
                        f.get("default_filename", source_path.name)
                        for f in installation_requirements.get("required_files", [])
                        + installation_requirements.get("optional_files", [])
                        if f["name"] == name
                    ),
                    source_path.name,
                )
                dest_path = (models_dir / dest_filename).resolve()
                copy_result = smart_copy_file(source_path, dest_path)
                if copy_result["success"]:
                    copied_files[name] = str(dest_path)
                else:
                    return jsonify({"error": f"Error copying {name}: {copy_result['error']}"}), 500

        success, logs = install_component(component_name, verbose=False, skip_install_script=False)

        if success:
            installation_config = {
                "file_paths": copied_files,
                "original_file_paths": file_paths,
                "installation_date": datetime.now().isoformat(),
            }
            with sqlite3.connect(manager.db_path) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO component_configurations (component_name, config_type, parameters) VALUES (?, 'installation', ?)",
                    (component_name, json.dumps(installation_config)),
                )
            return jsonify({"success": True, "message": "Component installed successfully.", "logs": logs})
        else:
            return (
                jsonify({"success": False, "error": "Installation failed. See logs for details.", "logs": logs}),
                500,
            )
    except ComponentInstallationError as e:
        logger.error(f"A handled installation error occurred: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        logger.error(f"An unhandled error occurred during installation: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"An unexpected server error occurred: {e}"}), 500


@component_manager_bp.route("/pipeline_components/uninstall", methods=["POST"])
def uninstall_pipeline_component():
    """Uninstall a pipeline component."""
    data = request.get_json()
    component_name = data.get("component_name")
    if not component_name:
        return jsonify({"success": False, "error": "Component name is required"}), 400
    try:
        success = uninstall_component(component_name, verbose=False)
        if success:
            return jsonify({"success": True, "message": f"Component {component_name} uninstalled successfully"})
        else:
            return jsonify({"success": False, "error": f"Failed to uninstall component {component_name}"}), 500
    except Exception as e:
        logger.error(f"Error uninstalling component {component_name}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/<component_name>/config", methods=["GET"])
def get_component_config_with_installation(component_name):
    """Get component configuration including installation requirements and stored values."""
    try:
        component_path = COMPONENTS_DIR / component_name
        if not component_path.exists():
            return jsonify({"error": "Component not found"}), 404

        with open(component_path / "component.yaml", "r") as f:
            component_spec = yaml.safe_load(f)

        merged_spec = merge_installation_config_with_defaults(component_spec, component_name)
        config_loader = ComponentConfigLoader(component_path)
        parameter_groups = config_loader.get_parameter_groups()

        # If no parameter_groups are defined, check for legacy 'params' and convert them
        if not parameter_groups and "params" in merged_spec:
            legacy_params = merged_spec.get("params", [])
            if legacy_params:
                # Create a default group for the legacy parameters
                parameter_groups = [
                    {
                        "title": "General Parameters",
                        "description": "Component-specific settings.",
                        "parameters": legacy_params,
                    }
                ]

        return jsonify(
            {
                "success": True,
                "component_name": component_name,
                "inputs": merged_spec.get("inputs", []),
                "outputs": merged_spec.get("outputs", []),
                "parameter_groups": parameter_groups,
                "specification": merged_spec,
            }
        )
    except Exception as e:
        logger.error(f"Error loading component config for {component_name}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/<component_name>/config", methods=["POST"])
def save_pipeline_component_config(component_name):
    """Save configuration for a specific component in the currently loaded project DB."""
    if not project_manager.is_loaded:
        return jsonify({"success": False, "error": "No project loaded"}), 400

    data = request.get_json()
    parameters = data.get("parameters", {})
    try:
        success = execute_db(
            project_manager.db_path,
            "INSERT OR REPLACE INTO component_configurations (component_name, parameters, updated_at) VALUES (?, ?, datetime('now'))",
            (component_name, json.dumps(parameters)),
        )
        if success:
            return jsonify({"success": True, "message": f"Configuration saved for {component_name}"})
        else:
            return jsonify({"success": False, "error": "Database operation failed"}), 500
    except Exception as e:
        logger.error(f"Error saving component config for {component_name}: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/<component_name>/templates", methods=["GET", "POST"])
def handle_component_templates(component_name):
    """List or save parameter templates for a component."""
    templates_dir = COMPONENTS_DIR / component_name / "templates"

    if request.method == "GET":
        if not templates_dir.exists():
            return jsonify({"success": True, "templates": []})
        try:
            templates = sorted([f.stem for f in templates_dir.glob("*.yaml")])
            return jsonify({"success": True, "templates": templates})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500

    if request.method == "POST":
        data = request.get_json()
        template_name = data.get("template_name")
        parameters = data.get("parameters")
        if not template_name or not parameters:
            return jsonify({"error": "template_name and parameters are required"}), 400

        safe_name = "".join(c for c in template_name if c.isalnum() or c in (" ", "_", "-")).rstrip()
        if not safe_name:
            return jsonify({"error": "Invalid template name"}), 400

        try:
            templates_dir.mkdir(parents=True, exist_ok=True)
            with open(templates_dir / f"{safe_name}.yaml", "w") as f:
                yaml.dump({"parameters": parameters}, f, default_flow_style=False)
            return jsonify({"success": True, "message": f"Template '{safe_name}' saved."})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/<component_name>/templates/<template_name>", methods=["GET"])
def get_component_template(component_name, template_name):
    """Loads a specific parameter template."""
    safe_name = Path(template_name).name
    template_file = COMPONENTS_DIR / component_name / "templates" / f"{safe_name}.yaml"
    if not template_file.is_file():
        return jsonify({"error": "Template not found"}), 404
    try:
        with open(template_file, "r") as f:
            data = yaml.safe_load(f)
        return jsonify({"success": True, "parameters": data.get("parameters", {})})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/optimize", methods=["POST"])
def optimize_pipeline_components():
    """Optimize shared dependencies"""
    try:
        from ..legacy.component_installer import optimize_dependencies

        success = optimize_dependencies(verbose=False)
        if success:
            return jsonify({"success": True, "message": "Dependencies optimized successfully"})
        else:
            return jsonify({"success": False, "error": "Failed to optimize dependencies"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@component_manager_bp.route("/pipeline_components/storage", methods=["GET"])
def get_component_storage_info():
    """Get component storage and dependency information"""
    try:
        from ..legacy.component_manager import ComponentEnvironmentManager

        manager = ComponentEnvironmentManager(COMPONENTS_DIR, DB_PATH, use_shared_deps=True)
        if hasattr(manager, "get_dependency_report"):
            report = manager.get_dependency_report()
            return jsonify(report)
        else:
            return jsonify({"error": "Dependency report not available"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
