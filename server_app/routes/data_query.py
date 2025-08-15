# server_app/routes/data_query.py
from flask import Blueprint, jsonify, request

from ..services.database import query_db
from ..services.project_manager import project_manager
from ..utils.decorators import project_required

data_query_bp = Blueprint("data_query_bp", __name__)


@data_query_bp.route("/files", methods=["GET"])
@project_required
def get_files_route():
    page = request.args.get("page", 1, type=int)
    limit = request.args.get("limit", 25, type=int)
    search = request.args.get("search", "", type=str)
    offset = (page - 1) * limit

    base_query = "FROM source_files"
    where_clauses = []
    params = []

    if search:
        where_clauses.append("filename LIKE ?")
        params.append(f"%{search}%")

    where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    items_query = f"SELECT filename, relative_path, size_bytes, mime_type, file_type, status {base_query}{where_sql} ORDER BY filename LIMIT ? OFFSET ?"
    count_query = f"SELECT COUNT(*) as total_count {base_query}{where_sql}"

    items = query_db(project_manager.db_path, items_query, params + [limit, offset])
    total_items_data = query_db(project_manager.db_path, count_query, params)
    total_items = total_items_data[0]["total_count"] if total_items_data else 0

    return jsonify(
        {
            "items": items if items else [],
            "totalItems": total_items,
            "page": page,
            "totalPages": (total_items + limit - 1) // limit if total_items > 0 else 1,
        }
    )


@data_query_bp.route("/zenodo_record", methods=["GET"])
@project_required
def get_zenodo_record_route():
    query = "SELECT record_title, zenodo_doi, record_status, record_metadata_json, version FROM zenodo_records ORDER BY last_updated_timestamp DESC LIMIT 1;"
    data = query_db(project_manager.db_path, query)
    return jsonify(data[0] if data else {})


@data_query_bp.route("/pipeline_steps", methods=["GET"])
@project_required
def get_pipeline_steps_route():
    query = "SELECT modality, component_name, component_order, is_active, parameters FROM project_pipelines ORDER BY modality, component_order;"
    data = query_db(project_manager.db_path, query)
    return jsonify(data if data else [])


@data_query_bp.route("/configuration", methods=["GET"])
@project_required
def get_configuration_route():
    query = "SELECT config_key, config_value FROM project_configuration;"
    data = query_db(project_manager.db_path, query)
    return jsonify(data if data else [])


@data_query_bp.route("/batches", methods=["GET"])
@project_required
def get_batches_route():
    query = (
        "SELECT batch_name, batch_description, status, created_timestamp FROM batches ORDER BY created_timestamp DESC;"
    )
    data = query_db(project_manager.db_path, query)
    return jsonify(data if data else [])


@data_query_bp.route("/apilog", methods=["GET"])
@project_required
def get_apilog_route():
    page = request.args.get("page", 1, type=int)
    limit = request.args.get("limit", 25, type=int)
    offset = (page - 1) * limit

    items_query = "SELECT timestamp, http_method, endpoint_url, response_status_code, status FROM api_log ORDER BY timestamp DESC LIMIT ? OFFSET ?;"
    count_query = "SELECT COUNT(*) as total_count FROM api_log;"

    items = query_db(project_manager.db_path, items_query, (limit, offset))
    total_items_data = query_db(project_manager.db_path, count_query)
    total_items = total_items_data[0]["total_count"] if total_items_data else 0

    return jsonify(
        {
            "items": items if items else [],
            "totalItems": total_items,
            "page": page,
            "totalPages": (total_items + limit - 1) // limit if total_items > 0 else 1,
        }
    )


@data_query_bp.route("/credentials", methods=["GET"])
@project_required
def get_credentials_route():
    query = "SELECT credential_name, credential_type, is_sandbox FROM api_credentials ORDER BY credential_name;"
    data = query_db(project_manager.db_path, query)
    return jsonify(data if data else [])


@data_query_bp.route("/records/<int:record_id>/files", methods=["GET"])
@project_required
def get_record_files(record_id):
    """
    Retrieves a detailed list of all files associated with a specific Zenodo record.
    """
    query_str = """
        SELECT
            sf.file_id,
            sf.filename,
            sf.absolute_path,
            sf.file_type,
            sf.pipeline_source,
            sf.step_source,
            rfm.upload_status
        FROM record_files_map rfm
        JOIN source_files sf ON rfm.file_id = sf.file_id
        WHERE rfm.record_id = ?
        ORDER BY sf.file_type DESC, sf.filename ASC
    """
    files = query_db(project_manager.db_path, query_str, (record_id,))

    if files is None:
        return jsonify({"error": "Database query failed"}), 500

    return jsonify(files)
