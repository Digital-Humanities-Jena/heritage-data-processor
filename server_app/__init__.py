# server_app/__init__.py
import logging
from flask import Flask
from flask_cors import CORS
from pathlib import Path

from .config import load_configuration

from .services.project_manager import project_manager
from .services.component_service import component_executor


def create_app(config_path: str, enable_alpha_features=False):
    """
    Creates and configures the Flask application.
    This is the Application Factory.
    """
    app = Flask(__name__)
    CORS(app)

    # --- Check if Alpha Features enabled ---
    if enable_alpha_features:
        app.config["developer"] = app.config.get("developer", {})
        app.config["developer"]["alpha_features_enabled"] = True
        print("✅ Alpha features have been FORCE-ENABLED via command-line flag.")

    # --- Configuration ---
    load_configuration(app, config_path)
    print(f"✅ Python server starting. Main configuration is set to: {app.config['CONFIG_FILE_PATH']}")
    if app.config.get("LOADED_CONFIG"):
        print("   Configuration loaded successfully.")
    else:
        print("   WARNING: Configuration could not be loaded or is empty.")

    # --- Logging ---
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    app.logger.info("Flask application initialized.")

    # --- Initialize Services ---
    # Services that hold state are initialized here
    project_manager.init_app(app)
    component_executor.init_app(app)

    # --- Register Blueprints ---
    from .routes.project import project_bp
    from .routes.data_query import data_query_bp
    from .routes.settings import settings_bp
    from .routes.operability import operability_bp
    from .routes.zenodo import zenodo_bp
    from .routes.component_manager import component_manager_bp
    from .routes.component_runner import component_runner_bp
    from .routes.pipeline_manager import pipeline_manager_bp
    from .routes.utils import utils_bp
    from .routes.batch_actions import batch_actions_bp
    from .routes.cli_routes import cli_bp

    app.register_blueprint(project_bp, url_prefix="/api")
    app.register_blueprint(data_query_bp, url_prefix="/api")
    app.register_blueprint(settings_bp, url_prefix="/api")
    app.register_blueprint(operability_bp, url_prefix="/api")
    app.register_blueprint(zenodo_bp, url_prefix="/api")
    app.register_blueprint(component_manager_bp, url_prefix="/api")
    app.register_blueprint(component_runner_bp, url_prefix="/api")
    app.register_blueprint(pipeline_manager_bp, url_prefix="/api")
    app.register_blueprint(utils_bp, url_prefix="/api")
    app.register_blueprint(batch_actions_bp, url_prefix="/api")
    app.register_blueprint(cli_bp, url_prefix="/api")

    # A simple health check route
    @app.route("/api/health", methods=["GET"])
    def health_check():
        return {"status": "ok"}, 200

    return app
