# server_app/routes/settings.py
import logging
import os
from pathlib import Path
import yaml

from flask import Blueprint, current_app, jsonify, request

from ..config import load_configuration

settings_bp = Blueprint("settings_bp", __name__)
logger = logging.getLogger(__name__)


@settings_bp.route("/config/get", methods=["GET"])
def get_config_route():
    """
    Reads and returns the current application config as JSON,
    and includes the absolute path of the config file's directory.
    """
    try:
        # Get the globally loaded config and its path from the app context
        config_data = current_app.config.get("LOADED_CONFIG")
        config_file_path = current_app.config.get("CONFIG_FILE_PATH")

        if not config_data or not config_file_path:
            return jsonify({"error": "Configuration not loaded or is empty. Check server logs."}), 500

        abs_config_file_path = Path(config_file_path).resolve()
        config_dir_abs_path = str(abs_config_file_path.parent)

        return jsonify({"configData": config_data, "configDirAbsPath": config_dir_abs_path})

    except Exception as e:
        logger.error(f"Error in /api/config/get: {e}", exc_info=True)
        return jsonify({"error": f"Failed to process configuration: {str(e)}"}), 500


@settings_bp.route("/config/save", methods=["POST"])
def save_config():
    """Receives JSON data and overwrites the config.yaml file."""
    config_file_path = current_app.config.get("CONFIG_FILE_PATH")
    if not config_file_path:
        return jsonify({"error": "Configuration file path is not set."}), 500

    try:
        new_config_data = request.get_json()
        if not new_config_data:
            return jsonify({"error": "No configuration data received."}), 400

        # Create a backup of the old config before overwriting
        backup_path = config_file_path + ".bak"
        if os.path.exists(config_file_path):
            os.rename(config_file_path, backup_path)

        with open(config_file_path, "w", encoding="utf-8") as f:
            yaml.dump(new_config_data, f, default_flow_style=False, sort_keys=False, indent=2)

        # After saving, reload the configuration into the running app
        load_configuration(current_app, config_file_path)
        logger.info("Configuration saved and reloaded successfully.")

        return jsonify({"message": "Configuration saved successfully."})

    except Exception as e:
        logger.error(f"Error in /api/config/save: {e}", exc_info=True)
        # If saving fails, try to restore the backup
        if os.path.exists(backup_path):
            os.rename(backup_path, config_file_path)
        return jsonify({"error": f"Failed to save config file: {str(e)}"}), 500


@settings_bp.route("/config/get_prompt_keys", methods=["GET"])
def get_prompt_keys_route():
    """
    Reads the prompts.yaml file (path specified in config.yaml) and returns
    its top-level or sub-level keys.
    """
    prompt_id_to_filter = request.args.get("prompt_id")
    config_data = current_app.config.get("LOADED_CONFIG")
    config_dir = Path(current_app.config.get("CONFIG_FILE_PATH")).parent

    try:
        prompts_file_relative_path = config_data.get("paths", {}).get("prompts_file")
        if not prompts_file_relative_path:
            return jsonify({"error": "Path to prompts.yaml ('paths.prompts_file') not defined in config."}), 500

        abs_prompts_file_path = (config_dir / prompts_file_relative_path).resolve()
        if not abs_prompts_file_path.exists():
            return jsonify({"error": f"Prompts file not found at {abs_prompts_file_path}"}), 404

        with open(abs_prompts_file_path, "r", encoding="utf-8") as f_prompts:
            prompts_data = yaml.safe_load(f_prompts)

        if not isinstance(prompts_data, dict):
            return jsonify({"error": "Prompts file is not a valid YAML dictionary."}), 500

        if prompt_id_to_filter:
            # Return sub-keys for a specific prompt_id
            if prompt_id_to_filter in prompts_data and isinstance(prompts_data[prompt_id_to_filter], dict):
                return jsonify(list(prompts_data[prompt_id_to_filter].keys()))
            else:
                return jsonify([])  # Return empty list if ID not found or not a dict
        else:
            # Return all top-level keys, excluding 'settings'
            all_keys = list(prompts_data.keys())
            filtered_keys = [key for key in all_keys if key != "settings"]
            return jsonify(filtered_keys)

    except Exception as e:
        logger.error(f"Error fetching prompt keys: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500
