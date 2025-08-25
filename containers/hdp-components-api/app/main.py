import logging
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import atexit

from config.config import Config
from app.auth import require_api_key
from app.services.component_service import ComponentService
from app.services.zenodo_service import ZenodoService
from app.services.scheduler_service import scheduler_service


def create_app():
    """Application factory."""
    app = Flask(__name__)
    app.config.from_object(Config)
    Config.init_app(app)

    CORS(app)

    logging.basicConfig(
        level=logging.INFO if not app.config["DEBUG"] else logging.DEBUG,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger = logging.getLogger(__name__)

    # Initialize and start the scheduler
    scheduler_service.initialize_with_app(app)
    with app.app_context():
        scheduler_service.start()

    # Ensure scheduler stops on app shutdown
    atexit.register(lambda: scheduler_service.stop())

    @app.route("/hdp/v1/health", methods=["GET"])
    def health_check_api():
        """Health check endpoint for API route."""
        return jsonify(
            {
                "status": "healthy",
                "service": "hdp-components-api",
                "version": "0.1.0",
                "scheduler_enabled": app.config.get("ENABLE_SCHEDULER", True),
            }
        )

    @app.route("/hdp/v1/available-components", methods=["GET"])
    def get_available_components():
        """GET endpoint to retrieve all available components."""
        try:
            components = ComponentService.get_components()

            component_count = len([k for k in components.keys() if k != "metadata"])
            logger.info(f"Served {component_count} components to {request.remote_addr}")

            return jsonify(components)

        except ValueError as e:
            logger.error(f"Validation error: {e}")
            return jsonify({"error": "Data validation error", "message": str(e)}), 500
        except Exception as e:
            logger.error(f"Unexpected error in GET components: {e}")
            return jsonify({"error": "Internal server error", "message": "Failed to retrieve components"}), 500

    @app.route("/hdp/v1/available-components", methods=["POST"])
    @require_api_key
    def update_available_components():
        """POST endpoint to update available components (authenticated)."""
        try:
            if not request.is_json:
                return jsonify({"error": "Invalid content type", "message": "Request must contain JSON data"}), 400

            components_data = request.get_json()

            if not components_data:
                return jsonify({"error": "Empty request", "message": "Request body cannot be empty"}), 400

            # Update components
            ComponentService.update_components(components_data)

            logger.info(f"Components manually updated by {request.remote_addr}")

            component_count = len([k for k in components_data.keys() if k != "metadata"])

            return jsonify(
                {
                    "success": True,
                    "message": f"Successfully updated {len(components_data)} components",
                    "count": component_count,
                }
            )

        except ValueError as e:
            logger.error(f"Validation error in POST components: {e}")
            return jsonify({"error": "Data validation error", "message": str(e)}), 400
        except Exception as e:
            logger.error(f"Unexpected error in POST components: {e}")
            return jsonify({"error": "Internal server error", "message": "Failed to update components"}), 500

    @app.route("/hdp/v1/update-available-components", methods=["POST"])
    @require_api_key
    def update_from_zenodo():
        """POST endpoint to fetch updates from Zenodo and update components."""
        try:
            logger.info(f"Manual Zenodo update triggered by {request.remote_addr}")

            # Perform synchronous update to get immediate results
            zenodo_service = ZenodoService(
                community_id=app.config["ZENODO_COMMUNITY_ID"],
                user_agent=app.config["ZENODO_USER_AGENT"],
                timeout=app.config["REQUEST_TIMEOUT"],
            )

            # Fetch components from Zenodo
            zenodo_components = zenodo_service.fetch_community_components()

            if not zenodo_components:
                # Return empty components if none found
                return jsonify(
                    {
                        "success": True,
                        "message": "No components found in Zenodo community",
                        "count": 0,
                        "components": {},
                        "source": "zenodo",
                        "community": app.config["ZENODO_COMMUNITY_ID"],
                    }
                )

            # Update local components file
            ComponentService.update_components(zenodo_components)

            logger.info(f"Zenodo update completed: {len(zenodo_components)} components updated")

            component_count = len([k for k in zenodo_components.keys() if k != "metadata"])

            return jsonify(
                {
                    "success": True,
                    "message": f"Successfully fetched and updated {component_count} components from Zenodo",
                    "count": component_count,
                    "components": zenodo_components,
                    "source": "zenodo",
                    "community": app.config["ZENODO_COMMUNITY_ID"],
                }
            )

        except requests.RequestException as e:
            logger.error(f"Network error during Zenodo update: {e}")
            return jsonify({"error": "Network error", "message": "Failed to connect to Zenodo", "components": {}}), 502
        except Exception as e:
            logger.error(f"Unexpected error in Zenodo update: {e}")
            return (
                jsonify(
                    {
                        "error": "Internal server error",
                        "message": "Failed to update components from Zenodo",
                        "components": {},
                    }
                ),
                500,
            )

    @app.errorhandler(404)
    def not_found(error):
        return jsonify({"error": "Not found", "message": "The requested endpoint does not exist"}), 404

    @app.errorhandler(405)
    def method_not_allowed(error):
        return (
            jsonify({"error": "Method not allowed", "message": "The method is not allowed for the requested URL"}),
            405,
        )

    @app.errorhandler(500)
    def internal_error(error):
        logger.error(f"Internal server error: {error}")
        return jsonify({"error": "Internal server error", "message": "An unexpected error occurred"}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host=app.config["HOST"], port=app.config["PORT"], debug=app.config["DEBUG"])
