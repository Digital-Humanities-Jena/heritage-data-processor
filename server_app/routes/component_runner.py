# server_app/routes/component_runner.py
import uuid
import json
import logging
from flask import Blueprint, request, jsonify, Response

from ..services.component_service import component_executor
from .component_runner_utils import build_full_command

component_runner_bp = Blueprint("component_runner_bp", __name__)
logger = logging.getLogger(__name__)


@component_runner_bp.route("/components/<component_name>/run", methods=["POST"])
def run_component(component_name: str):
    """
    Receives a component run request, uses utility functions to build a valid
    execution command, and starts the execution via the component_executor service.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON payload"}), 400

        # Directly use the structured inputs and parameters from the request.
        # No need for complex sorting; the frontend should send structured data.
        inputs = data.get("inputs", {})
        parameters = data.get("parameters", {})
        output_directory = data.get("output_directory")

        if not output_directory:
            return jsonify({"error": "Missing 'output_directory'"}), 400

        # STEP 1: Delegate command building to the utility function.
        # This function will handle introspection, output strategy, and parameter merging.
        cmd, component_spec, output_strategy, merged_params, install_config = build_full_command(
            component_name, inputs, parameters, output_directory
        )

        # STEP 2: Generate a unique ID for this execution.
        execution_id = str(uuid.uuid4())

        # STEP 3: Start the execution using the executor service.
        component_executor.start_execution(
            execution_id=execution_id,
            cmd=cmd,
            component_name=component_name,
            component_spec=component_spec,
            output_strategy=output_strategy,
            inputs=inputs,
            merged_parameters=merged_params,
            installation_config=install_config,
            output_directory=output_directory,
        )

        # STEP 4: Return a comprehensive success response.
        return (
            jsonify(
                {
                    "success": True,
                    "execution_id": execution_id,
                    "message": "Component execution started",
                    "command": " ".join(f'"{arg}"' if " " in arg else arg for arg in cmd),
                    "output_strategy": output_strategy.get("strategy"),
                    "estimated_outputs": output_strategy.get("output_paths", [output_directory]),
                }
            ),
            202,
        )

    except FileNotFoundError as e:
        logger.error(f"File not found during component run setup: {e}")
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Error starting component {component_name}: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


@component_runner_bp.route("/components/logs/<execution_id>")
def stream_component_logs(execution_id):
    """Streams component execution logs using Server-Sent Events."""

    def generate_logs():
        log_queue = component_executor.get_log_queue(execution_id)
        if not log_queue:
            yield f"data: {json.dumps({'level': 'error', 'message': 'Execution not found'})}\n\n"
            return

        while True:
            try:
                log_message = log_queue.get(timeout=1)
                yield f"data: {json.dumps(log_message)}\n\n"
                if log_message.get("status") in ["completed", "failed", "cancelled"]:
                    break
            except:
                yield ": heartbeat\n\n"
                execution = component_executor.get_execution(execution_id)
                if not execution or execution.get("status") in ["completed", "failed", "cancelled"]:
                    break

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }
    return Response(generate_logs(), headers=headers)


@component_runner_bp.route("/components/<execution_id>/cancel", methods=["POST"])
def cancel_component_execution(execution_id):
    """Cancels a running component execution via the executor service."""
    if component_executor.cancel_execution(execution_id):
        return jsonify({"success": True, "message": "Execution cancelled"})
    else:
        return jsonify({"error": "Execution not found or already completed"}), 404


@component_runner_bp.route("/components/executions/<execution_id>/status", methods=["GET"])
def get_component_execution_status(execution_id):
    """
    Returns the current status and results of a specific component execution.
    """
    execution = component_executor.get_execution(execution_id)
    if not execution:
        return jsonify({"error": "Execution not found"}), 404

    status = execution.get("status")
    response_data = {"status": status}

    # If the execution is complete, include the output paths in the response.
    # This is crucial for the pipeline to know the correct, final paths.
    if status == "completed":
        output_strategy = execution.get("output_strategy", {})
        response_data["results"] = {"output_files": output_strategy.get("output_paths", [])}
    elif status == "failed":
        response_data["error"] = f"Execution {execution_id} failed."

    return jsonify(response_data), 200
