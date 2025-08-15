# server_app/utils/decorators.py
from functools import wraps
from flask import jsonify
from ..services.project_manager import project_manager


def project_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not project_manager.is_loaded:
            return jsonify({"error": "No HDPC project loaded. This action requires a project."}), 400
        return f(*args, **kwargs)

    return decorated_function
