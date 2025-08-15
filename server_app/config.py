# server_app/config.py
import yaml
from pathlib import Path
from flask import Flask


def load_configuration(app: Flask, config_path: str):
    """Loads config.yaml into the Flask app config."""
    resolved_path = Path(config_path).resolve()
    app.config["CONFIG_FILE_PATH"] = str(resolved_path)
    app.config["LOADED_CONFIG"] = {}  # Default empty config

    if not resolved_path.is_file():
        app.logger.error(
            f"Configuration file not found at {resolved_path}. The application may not function correctly."
        )
        return

    try:
        with open(resolved_path, "r", encoding="utf-8") as f:
            config_data = yaml.safe_load(f)
            # Loaded Data is stored in a Custom Key
            app.config["LOADED_CONFIG"] = config_data
            app.logger.info(f"Configuration loaded successfully from {resolved_path}")
    except yaml.YAMLError as e:
        app.logger.error(f"Error parsing YAML configuration from {resolved_path}: {e}")
    except Exception as e:
        app.logger.error(f"An unexpected error occurred while loading configuration: {e}")


def get_resolved_config_path(app: Flask, relative_path_str: str) -> Path | None:
    """Resolves a path relative to the main application configuration file directory."""
    main_config_path_str = app.config.get("CONFIG_FILE_PATH")
    if not main_config_path_str or not relative_path_str:
        return None

    main_config_dir = Path(main_config_path_str).parent
    return (main_config_dir / relative_path_str).resolve()
