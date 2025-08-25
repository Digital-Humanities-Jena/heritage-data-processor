from functools import wraps
from flask import request, jsonify, current_app
import logging

logger = logging.getLogger(__name__)


def require_api_key(f):
    """Decorator to require API key authentication."""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check for API key in headers
        api_key = request.headers.get("X-API-Key")

        if not api_key:
            # Also check Authorization header
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                api_key = auth_header[7:]  # Remove 'Bearer ' prefix

        if not api_key:
            logger.warning(f"Unauthorized access attempt from {request.remote_addr}")
            return (
                jsonify(
                    {
                        "error": "API key required",
                        "message": "Please provide API key in X-API-Key header or Authorization: Bearer <key>",
                    }
                ),
                401,
            )

        if api_key != current_app.config["API_KEY"]:
            logger.warning(f"Invalid API key attempt from {request.remote_addr}")
            return jsonify({"error": "Invalid API key", "message": "The provided API key is not valid"}), 403

        logger.info(f"Authenticated request from {request.remote_addr}")
        return f(*args, **kwargs)

    return decorated_function
